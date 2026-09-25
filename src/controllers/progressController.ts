import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { activeEnrollment, fail, optionalText, serverError } from "../utils/lmsHttp";

// ── Timeline ─────────────────────────────────────────────────────────────────

type TimelineEvent = {
  id: string;
  type: "LESSON" | "MATERIAL" | "ANNOUNCEMENT" | "ASSIGNMENT" | "QUIZ" | "MEETING";
  title: string;
  subtitle: string | null;
  at: Date;
  link: string | null;
  meta: Record<string, unknown>;
};

// GET /api/student/courses/:courseId/timeline
// One reverse-chronological feed of everything new in a course — the student's
// default view, matching the Classroom/Canvas mental model.
export const getTimeline = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const userId = req.user!.id;

    const [modules, materials, announcements, assignments, quizzes, meetings, completions] =
      await Promise.all([
        prisma.module.findMany({
          where: { courseId },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            lessons: {
              orderBy: [{ order: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                title: true,
                type: true,
                durationMinutes: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.material.findMany({
          where: { courseId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            url: true,
            createdAt: true,
            uploadedBy: { select: { name: true, email: true } },
          },
        }),
        // Course-scoped plus platform-wide (courseId = null).
        prisma.announcement.findMany({
          where: { OR: [{ courseId }, { courseId: null }] },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            body: true,
            pinned: true,
            courseId: true,
            createdAt: true,
            author: { select: { name: true, email: true } },
          },
        }),
        prisma.assignment.findMany({
          where: { courseId, published: true },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            dueAt: true,
            maxPoints: true,
            allowLate: true,
            createdAt: true,
          },
        }),
        prisma.quiz.findMany({
          where: { courseId, published: true },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            dueAt: true,
            timeLimitMin: true,
            createdAt: true,
          },
        }),
        prisma.meeting.findMany({
          where: { courseId },
          orderBy: { scheduledAt: "desc" },
          select: {
            id: true,
            title: true,
            scheduledAt: true,
            durationMin: true,
            createdAt: true,
          },
        }),
        prisma.lessonCompletion.findMany({
          where: { studentId: userId, lesson: { module: { courseId } } },
          select: { lessonId: true, completedAt: true },
        }),
      ]);

    const completedAt = new Map(completions.map((c) => [c.lessonId, c.completedAt]));
    const events: TimelineEvent[] = [];

    for (const m of modules) {
      for (const l of m.lessons) {
        events.push({
          id: l.id,
          type: "LESSON",
          title: l.title,
          subtitle: m.title,
          at: l.createdAt,
          link: null,
          meta: {
            lessonType: l.type,
            durationMinutes: l.durationMinutes,
            completed: completedAt.has(l.id) || undefined,
            completedAt: completedAt.get(l.id) ?? undefined,
          },
        });
      }
    }

    for (const m of materials) {
      events.push({
        id: m.id,
        type: "MATERIAL",
        title: m.title,
        subtitle: m.description,
        at: m.createdAt,
        link: m.url,
        meta: {
          materialType: m.type,
          uploadedBy: m.uploadedBy?.name ?? m.uploadedBy?.email ?? null,
        },
      });
    }

    for (const a of announcements) {
      events.push({
        id: a.id,
        type: "ANNOUNCEMENT",
        title: a.title,
        subtitle: a.body,
        at: a.createdAt,
        link: null,
        meta: {
          pinned: a.pinned,
          platformWide: a.courseId === null,
          author: a.author.name ?? a.author.email,
        },
      });
    }

    for (const a of assignments) {
      events.push({
        id: a.id,
        type: "ASSIGNMENT",
        title: a.title,
        subtitle: a.dueAt ? `Due ${a.dueAt.toISOString()}` : "No deadline",
        at: a.createdAt,
        link: null,
        meta: { dueAt: a.dueAt, maxPoints: a.maxPoints, allowLate: a.allowLate },
      });
    }

    for (const q of quizzes) {
      events.push({
        id: q.id,
        type: "QUIZ",
        title: q.title,
        subtitle: q.dueAt ? `Due ${q.dueAt.toISOString()}` : "No deadline",
        at: q.createdAt,
        link: null,
        meta: { dueAt: q.dueAt, timeLimitMin: q.timeLimitMin },
      });
    }

    for (const m of meetings) {
      events.push({
        id: m.id,
        type: "MEETING",
        title: m.title,
        subtitle: `Live session · ${m.durationMin} min`,
        at: m.scheduledAt,
        link: null,
        meta: { scheduledAt: m.scheduledAt, durationMin: m.durationMin },
      });
    }

    // Pinned announcements float to the top; everything else is newest-first.
    events.sort((a, b) => {
      const pinA = a.type === "ANNOUNCEMENT" && a.meta.pinned ? 1 : 0;
      const pinB = b.type === "ANNOUNCEMENT" && b.meta.pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      return b.at.getTime() - a.at.getTime();
    });

    res.json({ events });
  } catch (error) {
    serverError(res, "getTimeline", "Failed to load the course timeline", error);
  }
};

// ── Lesson progress ──────────────────────────────────────────────────────────

/** Lessons are not course-scoped in the URL, so membership is resolved here. */
async function lessonCourse(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, module: { select: { courseId: true } } },
  });
  return lesson ? { lessonId: lesson.id, courseId: lesson.module.courseId } : null;
}

// POST /api/student/lessons/:lessonId/complete
export const completeLesson = async (req: AuthRequest, res: Response) => {
  try {
    const lessonId = String(req.params.lessonId);
    const found = await lessonCourse(lessonId);
    if (!found) return fail(res, 404, "Lesson not found");

    const membership = await activeEnrollment(found.courseId, req.user!.id);
    if (!membership.ok) return fail(res, 403, membership.message);

    const completion = await prisma.lessonCompletion.upsert({
      where: { lessonId_studentId: { lessonId, studentId: req.user!.id } },
      create: { lessonId, studentId: req.user!.id },
      update: {},
      select: { lessonId: true, completedAt: true },
    });
    res.json({ completed: true, ...completion });
  } catch (error) {
    serverError(res, "completeLesson", "Failed to mark the lesson complete", error);
  }
};

// DELETE /api/student/lessons/:lessonId/complete
export const uncompleteLesson = async (req: AuthRequest, res: Response) => {
  try {
    const lessonId = String(req.params.lessonId);
    const found = await lessonCourse(lessonId);
    if (!found) return fail(res, 404, "Lesson not found");

    const membership = await activeEnrollment(found.courseId, req.user!.id);
    if (!membership.ok) return fail(res, 403, membership.message);

    await prisma.lessonCompletion.deleteMany({ where: { lessonId, studentId: req.user!.id } });
    res.json({ completed: false, lessonId });
  } catch (error) {
    serverError(res, "uncompleteLesson", "Failed to clear the lesson progress", error);
  }
};

// ── Aggregates ───────────────────────────────────────────────────────────────

/** Progress bar for one course: completed lessons over total lessons. */
async function courseProgress(courseId: string, studentId: string) {
  const [total, done] = await Promise.all([
    prisma.lesson.count({ where: { module: { courseId } } }),
    prisma.lessonCompletion.count({
      where: { studentId, lesson: { module: { courseId } } },
    }),
  ]);
  return { lessonsTotal: total, lessonsCompleted: done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

// GET /api/student/courses/:courseId/progress
export const getCourseProgress = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const progress = await courseProgress(courseId, req.user!.id);
    res.json(progress);
  } catch (error) {
    serverError(res, "getCourseProgress", "Failed to load progress", error);
  }
};

// GET /api/student/my/grades
// Grade-so-far per course: only graded submissions and scored quiz attempts
// count toward the percentage, so an ungraded backlog never drags it down.
export const getMyGrades = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const enrollments = await prisma.enrollment.findMany({
      where: { userId, applicationStatus: "APPROVED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        courseId: true,
        accessStatus: true,
        courseCompleted: true,
        course: { select: { id: true, title: true, image: true } },
      },
    });
    const courseIds = enrollments.map((e) => e.courseId);
    if (courseIds.length === 0) return res.json({ courses: [] });

    const [submissions, attempts, assignments, quizzes] = await Promise.all([
      prisma.submission.findMany({
        where: { studentId: userId, assignment: { courseId: { in: courseIds } } },
        select: {
          id: true,
          grade: true,
          isLate: true,
          submittedAt: true,
          gradedAt: true,
          feedback: true,
          assignment: {
            select: { id: true, title: true, maxPoints: true, dueAt: true, courseId: true },
          },
        },
        orderBy: { submittedAt: "desc" },
      }),
      prisma.quizAttempt.findMany({
        where: { studentId: userId, submittedAt: { not: null }, quiz: { courseId: { in: courseIds } } },
        select: {
          id: true,
          autoScore: true,
          manualScore: true,
          finalScore: true,
          maxScore: true,
          submittedAt: true,
          feedback: true,
          quiz: { select: { id: true, title: true, courseId: true } },
        },
        orderBy: { submittedAt: "desc" },
      }),
      prisma.assignment.count({
        where: { courseId: { in: courseIds }, published: true },
      }),
      prisma.quiz.count({ where: { courseId: { in: courseIds }, published: true } }),
    ]);

    const courses = await Promise.all(
      enrollments.map(async (e) => {
        const mine = submissions.filter((s) => s.assignment.courseId === e.courseId);
        const graded = mine.filter((s) => s.grade !== null);
        const quizBest = new Map<string, (typeof attempts)[number]>();
        for (const a of attempts.filter((a) => a.quiz.courseId === e.courseId)) {
          const current = quizBest.get(a.quiz.id);
          if (!current || (a.finalScore ?? -1) > (current.finalScore ?? -1)) quizBest.set(a.quiz.id, a);
        }
        const scoredQuizzes = [...quizBest.values()].filter((a) => a.finalScore !== null);

        const earned =
          graded.reduce((sum, s) => sum + (s.grade ?? 0), 0) +
          scoredQuizzes.reduce((sum, a) => sum + (a.finalScore ?? 0), 0);
        const possible =
          graded.reduce((sum, s) => sum + s.assignment.maxPoints, 0) +
          scoredQuizzes.reduce((sum, a) => sum + a.maxScore, 0);

        return {
          course: e.course,
          accessStatus: e.accessStatus,
          courseCompleted: e.courseCompleted,
          percent: possible === 0 ? null : Math.round((earned / possible) * 100),
          pointsEarned: earned,
          pointsPossible: possible,
          progress: await courseProgress(e.courseId, userId),
          assignments: {
            total: assignments,
            submitted: mine.length,
            graded: graded.length,
            awaitingGrade: mine.filter((s) => s.grade === null).length,
          },
          quizzes: {
            total: quizzes,
            attempted: quizBest.size,
          },
          items: [
            ...mine.map((s) => ({
              kind: "ASSIGNMENT" as const,
              id: s.assignment.id,
              title: s.assignment.title,
              score: s.grade,
              maxScore: s.assignment.maxPoints,
              isLate: s.isLate,
              submittedAt: s.submittedAt,
              gradedAt: s.gradedAt,
              feedback: s.feedback,
            })),
            ...scoredQuizzes.map((a) => ({
              kind: "QUIZ" as const,
              id: a.quiz.id,
              title: a.quiz.title,
              score: a.finalScore,
              maxScore: a.maxScore,
              isLate: false,
              submittedAt: a.submittedAt,
              gradedAt: null,
              feedback: a.feedback,
            })),
          ].sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0)),
        };
      }),
    );

    res.json({ courses });
  } catch (error) {
    serverError(res, "getMyGrades", "Failed to load your grades", error);
  }
};

// GET /api/student/my/attendance
export const getMyAttendance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const enrollments = await prisma.enrollment.findMany({
      where: { userId, applicationStatus: "APPROVED" },
      orderBy: { createdAt: "desc" },
      select: { courseId: true, course: { select: { id: true, title: true, image: true } } },
    });
    const courseIds = enrollments.map((e) => e.courseId);
    if (courseIds.length === 0) return res.json({ courses: [] });

    const [meetings, records] = await Promise.all([
      prisma.meeting.findMany({
        where: { courseId: { in: courseIds } },
        orderBy: { scheduledAt: "desc" },
        select: { id: true, courseId: true, title: true, scheduledAt: true, durationMin: true },
      }),
      prisma.attendanceRecord.findMany({
        where: { studentId: userId },
        select: { meetingId: true, joinedAt: true, source: true },
      }),
    ]);

    const byMeeting = new Map(records.map((r) => [r.meetingId, r]));

    res.json({
      courses: enrollments.map((e) => {
        const mine = meetings.filter((m) => m.courseId === e.courseId);
        const attended = mine.filter((m) => byMeeting.has(m.id)).length;
        return {
          course: e.course,
          sessionsTotal: mine.length,
          sessionsAttended: attended,
          percent: mine.length === 0 ? null : Math.round((attended / mine.length) * 100),
          sessions: mine.map((m) => ({
            id: m.id,
            title: m.title,
            scheduledAt: m.scheduledAt,
            durationMin: m.durationMin,
            attended: byMeeting.has(m.id),
            joinedAt: byMeeting.get(m.id)?.joinedAt ?? null,
            source: byMeeting.get(m.id)?.source ?? null,
          })),
        };
      }),
    });
  } catch (error) {
    serverError(res, "getMyAttendance", "Failed to load your attendance", error);
  }
};

// GET /api/student/my/fees
export const getMyFees = async (req: AuthRequest, res: Response) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        applicationStatus: true,
        accessStatus: true,
        feeTier: true,
        fee: true,
        feeStatus: true,
        feeNotes: true,
        createdAt: true,
        course: { select: { id: true, title: true, image: true, cat: true } },
      },
    });

    const outstanding = enrollments
      .filter((e) => e.applicationStatus === "APPROVED" && e.feeStatus !== "paid" && e.feeTier !== "free")
      .reduce((sum, e) => sum + e.fee, 0);

    res.json({
      enrollments,
      summary: {
        outstandingAmount: outstanding,
        unpaid: enrollments.filter((e) => e.feeStatus === "unpaid").length,
        partial: enrollments.filter((e) => e.feeStatus === "partial").length,
        paid: enrollments.filter((e) => e.feeStatus === "paid").length,
      },
    });
  } catch (error) {
    serverError(res, "getMyFees", "Failed to load your fees", error);
  }
};

// GET /api/student/my/certificates
export const getMyCertificates = async (req: AuthRequest, res: Response) => {
  try {
    const certificates = await prisma.certificate.findMany({
      where: { userId: req.user!.id },
      orderBy: { issuedAt: "desc" },
      select: {
        id: true,
        title: true,
        url: true,
        issuedAt: true,
        course: { select: { id: true, title: true, image: true } },
      },
    });
    res.json({ certificates });
  } catch (error) {
    serverError(res, "getMyCertificates", "Failed to load your certificates", error);
  }
};

// ── Course completion ────────────────────────────────────────────────────────

// There is no certificate template engine yet, so the stored URL points at a
// stable public verification page and the record itself is the source of truth.
function certificateUrl(certificateId: string) {
  const base = process.env.LMS_URL || process.env.FRONTEND_URL || "https://lms.xoksis.com";
  return `${base.replace(/\/$/, "")}/certificates/${certificateId}`;
}

/** Idempotent: completing a course twice reuses the existing certificate. */
export async function issueCertificate(
  courseId: string,
  userId: string,
  opts: { note?: string | null } = {},
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true, courseCompleted: true, course: { select: { title: true } } },
  });
  if (!enrollment) return null;

  const existing = await prisma.certificate.findFirst({
    where: { userId, courseId },
    select: { id: true, title: true, url: true, issuedAt: true },
  });
  if (existing) {
    if (!enrollment.courseCompleted) {
      await prisma.enrollment.update({ where: { id: enrollment.id }, data: { courseCompleted: true } });
    }
    return existing;
  }

  const created = await prisma.certificate.create({
    data: {
      userId,
      courseId,
      title: enrollment.course.title,
      url: certificateUrl("pending"),
    },
    select: { id: true, title: true, url: true, issuedAt: true },
  });
  const withUrl = await prisma.certificate.update({
    where: { id: created.id },
    data: { url: certificateUrl(created.id) },
    select: { id: true, title: true, url: true, issuedAt: true },
  });

  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { courseCompleted: true },
  });

  await prisma.notification.create({
    data: {
      userId,
      title: "Course completed",
      message: `Your certificate for "${enrollment.course.title}" is ready to download.`,
    },
  });

  return withUrl;
}

// POST /api/student/courses/:courseId/complete
// Self-service completion, allowed once every lesson is ticked off.
export const requestCourseCompletion = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const userId = req.user!.id;

    const membership = await activeEnrollment(courseId, userId);
    if (!membership.ok) return fail(res, 403, membership.message);

    const progress = await courseProgress(courseId, userId);
    if (progress.lessonsTotal === 0) {
      return fail(res, 400, "This course has no lessons yet");
    }
    if (progress.lessonsCompleted < progress.lessonsTotal) {
      return fail(
        res,
        400,
        `Finish all lessons first — ${progress.lessonsCompleted} of ${progress.lessonsTotal} done`,
      );
    }

    const certificate = await issueCertificate(courseId, userId);
    res.json({ completed: true, certificate });
  } catch (error) {
    serverError(res, "requestCourseCompletion", "Failed to complete the course", error);
  }
};

// PUT /api/student/profile/signature — used on issued certificates.
export const updateSignature = async (req: AuthRequest, res: Response) => {
  try {
    const signature = optionalText(req.body?.signature, 2000);
    if (signature === null) return fail(res, 400, "Signature is too long (max 2000 characters)");

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { signature: signature ?? null },
      select: { id: true, signature: true },
    });
    res.json(updated);
  } catch (error) {
    serverError(res, "updateSignature", "Failed to save your signature", error);
  }
};
