import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { fail, optionalInt, optionalText, serverError, text } from "../utils/lmsHttp";
import { recordAudit } from "../utils/auditLog";
import { issueCertificate } from "./progressController";

const FEE_TIERS = ["free", "standard", "scholarship"] as const;
const FEE_STATUSES = ["unpaid", "partial", "paid"] as const;
const ACCESS_STATUSES = ["active", "revoked"] as const;

function oneOf(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return allowed.includes(normalised) ? normalised : null;
}

// ── Bulk student assignment ──────────────────────────────────────────────────

// POST /api/admin/enrollments/bulk-assign
// The "select students → assign to course" flow. Existing enrollments are
// refreshed rather than duplicated (userId+courseId is unique).
export const bulkAssignStudents = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = text(req.body?.courseId, 64);
    if (!courseId) return fail(res, 400, "courseId is required");

    const rawIds = req.body?.userIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return fail(res, 400, "userIds must be a non-empty array");
    }
    if (rawIds.length > 500) return fail(res, 400, "Assign at most 500 students at a time");
    const userIds = [...new Set(rawIds.map((id) => text(id, 64)).filter((id): id is string => !!id))];
    if (userIds.length === 0) return fail(res, 400, "No valid student ids were supplied");

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true },
    });
    if (!course) return fail(res, 404, "Course not found");

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, role: true, email: true },
    });
    const knownIds = new Set(users.map((u) => u.id));
    const unknown = userIds.filter((id) => !knownIds.has(id));

    const feeTier = oneOf(req.body?.feeTier, FEE_TIERS) ?? "free";
    const fee = optionalInt(req.body?.fee, 0, 10_000_000);
    if (fee === null) return fail(res, 400, "Fee must be a whole number of 0 or more");
    const feeAmount = fee ?? (feeTier === "free" ? 0 : 2500);
    const feeStatus = oneOf(req.body?.feeStatus, FEE_STATUSES) ?? "unpaid";

    const existing = await prisma.enrollment.findMany({
      where: { courseId, userId: { in: [...knownIds] } },
      select: { userId: true },
    });
    const alreadyEnrolled = new Set(existing.map((e) => e.userId));
    const toCreate = users.filter((u) => !alreadyEnrolled.has(u.id));

    if (toCreate.length > 0) {
      await prisma.enrollment.createMany({
        data: toCreate.map((u) => ({
          userId: u.id,
          courseId,
          email: u.email,
          fullName: null,
          applicationStatus: "APPROVED",
          accessStatus: "active",
          feeTier,
          fee: feeAmount,
          feeStatus,
        })),
        skipDuplicates: true,
      });

      await prisma.notification.createMany({
        data: toCreate.map((u) => ({
          userId: u.id,
          title: "You have been enrolled",
          message: `You now have access to "${course.title}".`,
        })),
      });
    }

    recordAudit(req.user!.id, "enrollment.bulkAssign", "Course", courseId, {
      requested: userIds.length,
      created: toCreate.length,
      skipped: alreadyEnrolled.size,
      unknown: unknown.length,
    });

    res.status(201).json({
      course,
      created: toCreate.length,
      alreadyEnrolled: [...alreadyEnrolled],
      unknown,
    });
  } catch (error) {
    serverError(res, "bulkAssignStudents", "Failed to assign students", error);
  }
};

// ── Enrollments / fees ───────────────────────────────────────────────────────

// GET /api/admin/enrollments?status=unpaid&courseId=…&q=…
export const listEnrollments = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;
    const feeStatus = oneOf(req.query.feeStatus, FEE_STATUSES);
    const accessStatus = oneOf(req.query.accessStatus, ACCESS_STATUSES);
    const applicationStatus = oneOf(req.query.applicationStatus, [
      "pending",
      "approved",
      "rejected",
    ]);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where = {
      ...(courseId && { courseId }),
      ...(feeStatus && { feeStatus }),
      ...(accessStatus && { accessStatus }),
      ...(applicationStatus && { applicationStatus: applicationStatus.toUpperCase() }),
      ...(q && {
        OR: [
          { user: { email: { contains: q, mode: "insensitive" as const } } },
          { user: { name: { contains: q, mode: "insensitive" as const } } },
          { fullName: { contains: q, mode: "insensitive" as const } },
          { course: { title: { contains: q, mode: "insensitive" as const } } },
        ],
      }),
    };

    const enrollments = await prisma.enrollment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        applicationStatus: true,
        accessStatus: true,
        courseCompleted: true,
        feeTier: true,
        fee: true,
        feeStatus: true,
        feeNotes: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, avatar: true } },
        course: { select: { id: true, title: true, image: true } },
      },
    });

    res.json({
      enrollments,
      summary: {
        total: enrollments.length,
        unpaid: enrollments.filter((e) => e.feeStatus === "unpaid").length,
        partial: enrollments.filter((e) => e.feeStatus === "partial").length,
        paid: enrollments.filter((e) => e.feeStatus === "paid").length,
        outstanding: enrollments
          .filter((e) => e.feeStatus !== "paid" && e.feeTier !== "free")
          .reduce((sum, e) => sum + e.fee, 0),
      },
    });
  } catch (error) {
    serverError(res, "listEnrollments", "Failed to load enrollments", error);
  }
};

// PATCH /api/admin/enrollments/:enrollmentId
export const updateEnrollment = async (req: AuthRequest, res: Response) => {
  try {
    const enrollmentId = String(req.params.enrollmentId);

    const data: {
      feeTier?: string;
      fee?: number;
      feeStatus?: string;
      feeNotes?: string | null;
      accessStatus?: string;
      applicationStatus?: string;
    } = {};

    if (req.body?.feeTier !== undefined) {
      const feeTier = oneOf(req.body.feeTier, FEE_TIERS);
      if (!feeTier) return fail(res, 400, `Fee tier must be one of: ${FEE_TIERS.join(", ")}`);
      data.feeTier = feeTier;
    }
    if (req.body?.fee !== undefined) {
      const fee = optionalInt(req.body.fee, 0, 10_000_000);
      if (fee === null || fee === undefined) return fail(res, 400, "Fee must be a whole number of 0 or more");
      data.fee = fee;
    }
    if (req.body?.feeStatus !== undefined) {
      const feeStatus = oneOf(req.body.feeStatus, FEE_STATUSES);
      if (!feeStatus) return fail(res, 400, `Fee status must be one of: ${FEE_STATUSES.join(", ")}`);
      data.feeStatus = feeStatus;
    }
    if (req.body?.feeNotes !== undefined) {
      const feeNotes = optionalText(req.body.feeNotes, 2000);
      if (feeNotes === null) return fail(res, 400, "Fee notes are too long (max 2000 characters)");
      data.feeNotes = feeNotes ?? null;
    }
    if (req.body?.accessStatus !== undefined) {
      const accessStatus = oneOf(req.body.accessStatus, ACCESS_STATUSES);
      if (!accessStatus) return fail(res, 400, `Access status must be one of: ${ACCESS_STATUSES.join(", ")}`);
      data.accessStatus = accessStatus;
    }
    if (req.body?.applicationStatus !== undefined) {
      const applicationStatus = oneOf(req.body.applicationStatus, ["pending", "approved", "rejected"]);
      if (!applicationStatus) {
        return fail(res, 400, "Application status must be PENDING, APPROVED or REJECTED");
      }
      data.applicationStatus = applicationStatus.toUpperCase();
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const updated = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data,
      select: {
        id: true,
        applicationStatus: true,
        accessStatus: true,
        feeTier: true,
        fee: true,
        feeStatus: true,
        feeNotes: true,
        user: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true } },
      },
    });

    recordAudit(req.user!.id, "enrollment.fee.update", "Enrollment", enrollmentId, {
      changes: data,
      student: updated.user.email,
      course: updated.course.title,
    });
    res.json(updated);
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "P2025") {
      return fail(res, 404, "Enrollment not found");
    }
    serverError(res, "updateEnrollment", "Failed to update the enrollment", error);
  }
};

// POST /api/admin/enrollments/bulk-fee — mark a set of enrollments paid/unpaid.
export const bulkUpdateFees = async (req: AuthRequest, res: Response) => {
  try {
    const rawIds = req.body?.enrollmentIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return fail(res, 400, "enrollmentIds must be a non-empty array");
    }
    if (rawIds.length > 1000) return fail(res, 400, "Update at most 1000 enrollments at a time");
    const enrollmentIds = rawIds.map((id) => text(id, 64)).filter((id): id is string => !!id);

    const feeStatus = oneOf(req.body?.feeStatus, FEE_STATUSES);
    if (!feeStatus) return fail(res, 400, `Fee status must be one of: ${FEE_STATUSES.join(", ")}`);

    const result = await prisma.enrollment.updateMany({
      where: { id: { in: enrollmentIds } },
      data: { feeStatus },
    });

    recordAudit(req.user!.id, "enrollment.fee.bulkUpdate", "Enrollment", null, {
      count: result.count,
      feeStatus,
    });
    res.json({ updated: result.count, feeStatus });
  } catch (error) {
    serverError(res, "bulkUpdateFees", "Failed to update the fees", error);
  }
};

// POST /api/admin/enrollments/:enrollmentId/certificate
export const issueEnrollmentCertificate = async (req: AuthRequest, res: Response) => {
  try {
    const enrollmentId = String(req.params.enrollmentId);
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { userId: true, courseId: true },
    });
    if (!enrollment) return fail(res, 404, "Enrollment not found");

    const certificate = await issueCertificate(enrollment.courseId, enrollment.userId);
    recordAudit(req.user!.id, "certificate.issue", "Enrollment", enrollmentId, {
      userId: enrollment.userId,
      courseId: enrollment.courseId,
    });
    res.status(201).json(certificate);
  } catch (error) {
    serverError(res, "issueEnrollmentCertificate", "Failed to issue the certificate", error);
  }
};

// ── Platform-wide announcements ──────────────────────────────────────────────

// GET /api/admin/announcements — platform-wide only (courseId = null).
export const listPlatformAnnouncements = async (req: AuthRequest, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({
      where: { courseId: null },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        body: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
    });
    res.json({ announcements });
  } catch (error) {
    serverError(res, "listPlatformAnnouncements", "Failed to load announcements", error);
  }
};

// POST /api/admin/announcements — fans out a notification to every active student.
export const createPlatformAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const title = text(req.body?.title, 200);
    if (!title) return fail(res, 400, "Announcement title is required (max 200 characters)");
    const body = text(req.body?.body, 10000);
    if (!body) return fail(res, 400, "Announcement body is required (max 10000 characters)");

    const announcement = await prisma.announcement.create({
      data: { courseId: null, authorId: req.user!.id, title, body, pinned: req.body?.pinned === true },
      select: { id: true, title: true, body: true, pinned: true, createdAt: true },
    });

    const recipients = await prisma.enrollment.findMany({
      where: { applicationStatus: "APPROVED", accessStatus: "active" },
      select: { userId: true },
      distinct: ["userId"],
      take: 5000,
    });
    if (recipients.length > 0) {
      await prisma.notification.createMany({
        data: recipients.map((r) => ({ userId: r.userId, title, message: body.slice(0, 500) })),
      });
    }

    recordAudit(req.user!.id, "announcement.platform.create", "Announcement", announcement.id, {
      notified: recipients.length,
    });
    res.status(201).json(announcement);
  } catch (error) {
    serverError(res, "createPlatformAnnouncement", "Failed to post the announcement", error);
  }
};

// PUT /api/admin/announcements/:announcementId
export const updatePlatformAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const announcementId = String(req.params.announcementId);
    const existing = await prisma.announcement.findFirst({
      where: { id: announcementId, courseId: null },
      select: { id: true },
    });
    if (!existing) return fail(res, 404, "Announcement not found");

    const data: { title?: string; body?: string; pinned?: boolean } = {};
    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 200);
      if (!title) return fail(res, 400, "Title cannot be empty (max 200 characters)");
      data.title = title;
    }
    if (req.body?.body !== undefined) {
      const body = text(req.body.body, 10000);
      if (!body) return fail(res, 400, "Body cannot be empty (max 10000 characters)");
      data.body = body;
    }
    if (req.body?.pinned !== undefined) {
      if (typeof req.body.pinned !== "boolean") return fail(res, 400, "pinned must be true or false");
      data.pinned = req.body.pinned;
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const updated = await prisma.announcement.update({
      where: { id: announcementId },
      data,
      select: { id: true, title: true, body: true, pinned: true, createdAt: true, updatedAt: true },
    });
    recordAudit(req.user!.id, "announcement.platform.update", "Announcement", announcementId, {
      changes: data,
    });
    res.json(updated);
  } catch (error) {
    serverError(res, "updatePlatformAnnouncement", "Failed to update the announcement", error);
  }
};

// DELETE /api/admin/announcements/:announcementId
export const deletePlatformAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const announcementId = String(req.params.announcementId);
    const existing = await prisma.announcement.findFirst({
      where: { id: announcementId, courseId: null },
      select: { id: true },
    });
    if (!existing) return fail(res, 404, "Announcement not found");

    await prisma.announcement.delete({ where: { id: announcementId } });
    recordAudit(req.user!.id, "announcement.platform.delete", "Announcement", announcementId);
    res.json({ message: "Announcement deleted", id: announcementId });
  } catch (error) {
    serverError(res, "deletePlatformAnnouncement", "Failed to delete the announcement", error);
  }
};

// ── Overviews ────────────────────────────────────────────────────────────────

// GET /api/admin/assignments — every assignment across every course.
export const listAllAssignments = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;
    const assignments = await prisma.assignment.findMany({
      where: courseId ? { courseId } : undefined,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        title: true,
        dueAt: true,
        maxPoints: true,
        allowLate: true,
        published: true,
        createdAt: true,
        course: { select: { id: true, title: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { submissions: true } },
      },
    });

    const graded = await prisma.submission.groupBy({
      by: ["assignmentId"],
      where: { grade: { not: null } },
      _count: { _all: true },
    });
    const gradedMap = new Map(graded.map((g) => [g.assignmentId, g._count._all]));

    res.json({
      assignments: assignments.map(({ _count, ...a }) => ({
        ...a,
        submittedCount: _count.submissions,
        gradedCount: gradedMap.get(a.id) ?? 0,
      })),
    });
  } catch (error) {
    serverError(res, "listAllAssignments", "Failed to load assignments", error);
  }
};

// GET /api/admin/quizzes — every quiz across every course.
export const listAllQuizzes = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;
    const quizzes = await prisma.quiz.findMany({
      where: courseId ? { courseId } : undefined,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        title: true,
        dueAt: true,
        timeLimitMin: true,
        attemptsAllowed: true,
        published: true,
        createdAt: true,
        course: { select: { id: true, title: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        questions: { select: { points: true, type: true } },
        _count: { select: { attempts: true } },
      },
    });

    res.json({
      quizzes: quizzes.map(({ questions, _count, ...q }) => ({
        ...q,
        questionCount: questions.length,
        totalPoints: questions.reduce((sum, qq) => sum + qq.points, 0),
        manualQuestionCount: questions.filter((qq) => qq.type === "LONG").length,
        attemptCount: _count.attempts,
      })),
    });
  } catch (error) {
    serverError(res, "listAllQuizzes", "Failed to load quizzes", error);
  }
};

// GET /api/admin/attendance?courseId=…
export const getAttendanceReport = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;

    const [meetings, enrolledCount, records] = await Promise.all([
      prisma.meeting.findMany({
        where: courseId ? { courseId } : undefined,
        orderBy: { scheduledAt: "desc" },
        take: 300,
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          durationMin: true,
          course: { select: { id: true, title: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.enrollment.groupBy({
        by: ["courseId"],
        where: { applicationStatus: "APPROVED", accessStatus: "active" },
        _count: { _all: true },
      }),
      prisma.attendanceRecord.findMany({
        where: courseId ? { meeting: { courseId } } : undefined,
        select: { meetingId: true, studentId: true, joinedAt: true, source: true, ipHash: true },
      }),
    ]);

    const enrolledByCourse = new Map(enrolledCount.map((e) => [e.courseId, e._count._all]));
    const byMeeting = new Map<string, typeof records>();
    for (const r of records) {
      const list = byMeeting.get(r.meetingId) ?? [];
      list.push(r);
      byMeeting.set(r.meetingId, list);
    }

    res.json({
      meetings: meetings.map((m) => {
        const mine = byMeeting.get(m.id) ?? [];
        const total = enrolledByCourse.get(m.course.id) ?? 0;
        // Only fingerprints used by more than one student count; a null hash
        // (unknown device) is not evidence of sharing.
        const perDevice = new Map<string, number>();
        for (const r of mine) {
          if (r.ipHash) perDevice.set(r.ipHash, (perDevice.get(r.ipHash) ?? 0) + 1);
        }
        const duplicateDeviceCount = [...perDevice.values()]
          .filter((n) => n > 1)
          .reduce((sum, n) => sum + n, 0);
        return {
          ...m,
          attendedCount: mine.length,
          enrolledCount: total,
          attendanceRate: total === 0 ? 0 : Math.round((mine.length / total) * 100),
          // A count above zero is the signal that one device checked in
          // several students — surfaced for the admin to review, not blocked.
          duplicateDeviceCount,
        };
      }),
    });
  } catch (error) {
    serverError(res, "getAttendanceReport", "Failed to load the attendance report", error);
  }
};

// GET /api/admin/audit?entityType=…&action=…&limit=…
export const listAuditLog = async (req: AuthRequest, res: Response) => {
  try {
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "100"), 10) || 100));

    const entries = await prisma.auditLog.findMany({
      where: { ...(entityType && { entityType }), ...(action && { action }) },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        meta: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    res.json({ entries });
  } catch (error) {
    serverError(res, "listAuditLog", "Failed to load the audit log", error);
  }
};

// ── LMS settings ─────────────────────────────────────────────────────────────

const SETTINGS_KEY = "lms-settings";
const DEFAULT_SETTINGS = {
  autoApproveEnrollments: true,
  defaultFeeTier: "free",
  defaultFeeAmount: 2500,
  discountAmount: 0,
  teacherPanelEnabled: true,
  certificateSignatureName: "XOKSIS Academy",
};

// GET /api/admin/lms-settings
export const getLmsSettings = async (req: AuthRequest, res: Response) => {
  try {
    const row = await prisma.siteContent.findUnique({ where: { key: SETTINGS_KEY } });
    const stored = (row?.content ?? {}) as Record<string, unknown>;
    res.json({ settings: { ...DEFAULT_SETTINGS, ...stored } });
  } catch (error) {
    serverError(res, "getLmsSettings", "Failed to load LMS settings", error);
  }
};

// PUT /api/admin/lms-settings
export const updateLmsSettings = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    const settings: Record<string, unknown> = {};

    if (body.autoApproveEnrollments !== undefined) {
      if (typeof body.autoApproveEnrollments !== "boolean") {
        return fail(res, 400, "autoApproveEnrollments must be true or false");
      }
      settings.autoApproveEnrollments = body.autoApproveEnrollments;
    }
    if (body.teacherPanelEnabled !== undefined) {
      if (typeof body.teacherPanelEnabled !== "boolean") {
        return fail(res, 400, "teacherPanelEnabled must be true or false");
      }
      settings.teacherPanelEnabled = body.teacherPanelEnabled;
    }
    if (body.defaultFeeTier !== undefined) {
      const tier = oneOf(body.defaultFeeTier, FEE_TIERS);
      if (!tier) return fail(res, 400, `Default fee tier must be one of: ${FEE_TIERS.join(", ")}`);
      settings.defaultFeeTier = tier;
    }
    if (body.defaultFeeAmount !== undefined) {
      const amount = optionalInt(body.defaultFeeAmount, 0, 10_000_000);
      if (amount === null || amount === undefined) {
        return fail(res, 400, "Default fee amount must be a whole number of 0 or more");
      }
      settings.defaultFeeAmount = amount;
    }
    if (body.discountAmount !== undefined) {
      const discount = optionalInt(body.discountAmount, 0, 10_000_000);
      if (discount === null || discount === undefined) {
        return fail(res, 400, "Discount must be a whole number of 0 or more");
      }
      settings.discountAmount = discount;
    }
    if (body.certificateSignatureName !== undefined) {
      const name = text(body.certificateSignatureName, 120);
      if (!name) return fail(res, 400, "Certificate signature name must be 1-120 characters");
      settings.certificateSignatureName = name;
    }
    if (Object.keys(settings).length === 0) return fail(res, 400, "Nothing to update");

    const existing = await prisma.siteContent.findUnique({ where: { key: SETTINGS_KEY } });
    const merged = {
      ...DEFAULT_SETTINGS,
      ...((existing?.content ?? {}) as Record<string, unknown>),
      ...settings,
    };

    const row = await prisma.siteContent.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, content: merged },
      update: { content: merged },
    });

    recordAudit(req.user!.id, "lms.settings.update", "SiteContent", SETTINGS_KEY, settings);
    res.json({ settings: row.content });
  } catch (error) {
    serverError(res, "updateLmsSettings", "Failed to save LMS settings", error);
  }
};

// ── Analytics ────────────────────────────────────────────────────────────────

// GET /api/admin/lms-analytics — platform-wide engagement and revenue snapshot.
export const getLmsAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const [
      students,
      mentors,
      courses,
      enrollments,
      activeEnrollments,
      completed,
      submissions,
      awaitingGrade,
      lessons,
      completions,
      meetings,
      attendance,
      feeRows,
      earned,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "USER" } }),
      prisma.user.count({ where: { role: "MENTOR" } }),
      prisma.course.count(),
      prisma.enrollment.count({ where: { applicationStatus: "APPROVED" } }),
      prisma.enrollment.count({ where: { applicationStatus: "APPROVED", accessStatus: "active" } }),
      prisma.enrollment.count({ where: { courseCompleted: true } }),
      prisma.submission.count(),
      prisma.submission.count({ where: { grade: null } }),
      prisma.lesson.count(),
      prisma.lessonCompletion.count(),
      prisma.meeting.count(),
      prisma.attendanceRecord.count(),
      prisma.enrollment.groupBy({
        by: ["feeStatus"],
        where: { applicationStatus: "APPROVED" },
        _count: { _all: true },
        _sum: { fee: true },
      }),
      prisma.enrollment.aggregate({
        where: { applicationStatus: "APPROVED", feeStatus: "paid" },
        _sum: { fee: true },
      }),
    ]);

    const feeCounts = Object.fromEntries(feeRows.map((f) => [f.feeStatus, f._count._all]));
    const outstanding = feeRows
      .filter((f) => f.feeStatus !== "paid")
      .reduce((sum, f) => sum + (f._sum.fee ?? 0), 0);

    res.json({
      users: { students, mentors },
      courses: { total: courses, enrollments, activeEnrollments, completed },
      assessments: { submissions, awaitingGrade },
      content: {
        lessons,
        completions,
        engagementPercent: activeEnrollments === 0 || lessons === 0
          ? 0
          : Math.round((completions / (activeEnrollments * lessons)) * 100),
      },
      attendance: {
        meetings,
        records: attendance,
        rate: activeEnrollments === 0 || meetings === 0
          ? 0
          : Math.round((attendance / (activeEnrollments * meetings)) * 100),
      },
      revenue: { collected: earned._sum.fee ?? 0, outstanding, feeCounts },
    });
  } catch (error) {
    serverError(res, "getLmsAnalytics", "Failed to load analytics", error);
  }
};
