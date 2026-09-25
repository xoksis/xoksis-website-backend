import { Response } from "express";
import { createHash } from "crypto";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import {
  activeEnrollment,
  fail,
  optionalDate,
  optionalInt,
  optionalText,
  optionalUrl,
  requestIp,
  serverError,
  text,
} from "../utils/lmsHttp";
import { courseAudience, notifyUsers } from "../utils/notify";

const MEETING_SELECT = {
  id: true,
  courseId: true,
  title: true,
  description: true,
  link: true,
  scheduledAt: true,
  durationMin: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function meetingInCourse(meetingId: string, courseId: string) {
  return prisma.meeting.findFirst({ where: { id: meetingId, courseId }, select: { id: true } });
}

/** Salted so the stored value can group repeat devices without holding an IP. */
function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}:${process.env.JWT_SECRET ?? "xoksis"}`).digest("hex").slice(0, 32);
}

// ── Teacher ──────────────────────────────────────────────────────────────────

// GET /api/teacher/courses/:courseId/meetings
export const listMeetings = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const [meetings, enrolledCount] = await Promise.all([
      prisma.meeting.findMany({
        where: { courseId },
        orderBy: { scheduledAt: "desc" },
        select: { ...MEETING_SELECT, _count: { select: { attendance: true } } },
      }),
      prisma.enrollment.count({ where: { courseId, applicationStatus: "APPROVED", accessStatus: "active" } }),
    ]);

    res.json({
      meetings: meetings.map(({ _count, ...m }) => ({
        ...m,
        attendedCount: _count.attendance,
        enrolledCount,
      })),
    });
  } catch (error) {
    serverError(res, "listMeetings", "Failed to load meetings", error);
  }
};

// POST /api/teacher/courses/:courseId/meetings
export const createMeeting = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);

    const title = text(req.body?.title, 200);
    if (!title) return fail(res, 400, "Meeting title is required (max 200 characters)");

    const link = optionalUrl(req.body?.link);
    if (!link) return fail(res, 400, "Meeting link must be a valid http(s) URL");

    const description = optionalText(req.body?.description, 2000);
    if (description === null) return fail(res, 400, "Description is too long (max 2000 characters)");

    const scheduledAt = optionalDate(req.body?.scheduledAt);
    if (!scheduledAt) return fail(res, 400, "A valid meeting date and time is required");

    const durationMin = optionalInt(req.body?.durationMin, 5, 600);
    if (durationMin === null) return fail(res, 400, "Duration must be between 5 and 600 minutes");

    const created = await prisma.meeting.create({
      data: {
        courseId,
        title,
        description,
        link,
        scheduledAt,
        durationMin: durationMin ?? 60,
        createdById: req.user!.id,
      },
      select: MEETING_SELECT,
    });

    const audience = await courseAudience(courseId);
    notifyUsers(
      audience,
      "New live session scheduled",
      `${created.title} — ${created.scheduledAt.toLocaleString()}`,
    );

    res.status(201).json(created);
  } catch (error) {
    serverError(res, "createMeeting", "Failed to schedule the meeting", error);
  }
};

// PUT /api/teacher/courses/:courseId/meetings/:meetingId
export const updateMeeting = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const meetingId = String(req.params.meetingId);
    if (!(await meetingInCourse(meetingId, courseId))) {
      return fail(res, 404, "Meeting not found in this course");
    }

    const data: {
      title?: string;
      description?: string | null;
      link?: string;
      scheduledAt?: Date;
      durationMin?: number;
    } = {};

    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 200);
      if (!title) return fail(res, 400, "Title cannot be empty (max 200 characters)");
      data.title = title;
    }
    if (req.body?.description !== undefined) {
      const description = optionalText(req.body.description, 2000);
      if (description === null) return fail(res, 400, "Description is too long (max 2000 characters)");
      data.description = description ?? null;
    }
    if (req.body?.link !== undefined) {
      const link = optionalUrl(req.body.link);
      if (!link) return fail(res, 400, "Meeting link must be a valid http(s) URL");
      data.link = link;
    }
    if (req.body?.scheduledAt !== undefined) {
      const scheduledAt = optionalDate(req.body.scheduledAt);
      if (!scheduledAt) return fail(res, 400, "Meeting date is not a valid date");
      data.scheduledAt = scheduledAt;
    }
    if (req.body?.durationMin !== undefined) {
      const durationMin = optionalInt(req.body.durationMin, 5, 600);
      if (durationMin === null || durationMin === undefined) {
        return fail(res, 400, "Duration must be between 5 and 600 minutes");
      }
      data.durationMin = durationMin;
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const updated = await prisma.meeting.update({
      where: { id: meetingId },
      data,
      select: MEETING_SELECT,
    });
    res.json(updated);
  } catch (error) {
    serverError(res, "updateMeeting", "Failed to update the meeting", error);
  }
};

// DELETE /api/teacher/courses/:courseId/meetings/:meetingId
export const deleteMeeting = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const meetingId = String(req.params.meetingId);
    if (!(await meetingInCourse(meetingId, courseId))) {
      return fail(res, 404, "Meeting not found in this course");
    }
    await prisma.meeting.delete({ where: { id: meetingId } });
    res.json({ message: "Meeting deleted", id: meetingId });
  } catch (error) {
    serverError(res, "deleteMeeting", "Failed to delete the meeting", error);
  }
};

// GET /api/teacher/courses/:courseId/meetings/:meetingId/attendance
export const getMeetingAttendance = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const meetingId = String(req.params.meetingId);

    const meeting = await prisma.meeting.findFirst({
      where: { id: meetingId, courseId },
      select: MEETING_SELECT,
    });
    if (!meeting) return fail(res, 404, "Meeting not found in this course");

    const [enrollments, records] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId, applicationStatus: "APPROVED" },
        orderBy: { createdAt: "desc" },
        select: { accessStatus: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
      }),
      prisma.attendanceRecord.findMany({
        where: { meetingId },
        orderBy: { joinedAt: "asc" },
        select: { id: true, studentId: true, joinedAt: true, source: true, ipHash: true },
      }),
    ]);

    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    res.json({
      meeting,
      roster: enrollments.map((e) => ({
        student: e.user,
        accessStatus: e.accessStatus,
        record: byStudent.get(e.user.id) ?? null,
      })),
    });
  } catch (error) {
    serverError(res, "getMeetingAttendance", "Failed to load attendance", error);
  }
};

// PUT /api/teacher/courses/:courseId/meetings/:meetingId/attendance/:studentId
// Manual override — the link click is a default, not the source of truth.
export const setMeetingAttendance = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const meetingId = String(req.params.meetingId);
    const studentId = String(req.params.studentId);

    if (!(await meetingInCourse(meetingId, courseId))) {
      return fail(res, 404, "Meeting not found in this course");
    }
    if (typeof req.body?.present !== "boolean") {
      return fail(res, 400, "present must be true or false");
    }

    const enrolled = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: studentId, courseId } },
      select: { id: true },
    });
    if (!enrolled) return fail(res, 404, "That student is not enrolled in this course");

    if (req.body.present) {
      const record = await prisma.attendanceRecord.upsert({
        where: { meetingId_studentId: { meetingId, studentId } },
        create: { meetingId, studentId, source: "MANUAL" },
        update: { source: "MANUAL" },
        select: { id: true, joinedAt: true, source: true },
      });
      return res.json({ present: true, record });
    }

    await prisma.attendanceRecord.deleteMany({ where: { meetingId, studentId } });
    res.json({ present: false });
  } catch (error) {
    serverError(res, "setMeetingAttendance", "Failed to update attendance", error);
  }
};

// ── Student ──────────────────────────────────────────────────────────────────

// GET /api/student/courses/:courseId/meetings
export const listMyMeetings = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const userId = req.user!.id;

    const [meetings, records] = await Promise.all([
      prisma.meeting.findMany({
        where: { courseId },
        orderBy: { scheduledAt: "desc" },
        select: MEETING_SELECT,
      }),
      prisma.attendanceRecord.findMany({
        where: { studentId: userId, meeting: { courseId } },
        select: { meetingId: true, joinedAt: true, source: true },
      }),
    ]);

    const byMeeting = new Map(records.map((r) => [r.meetingId, r]));
    const now = Date.now();

    res.json({
      meetings: meetings.map((m) => ({
        ...m,
        isUpcoming: m.scheduledAt.getTime() > now - m.durationMin * 60_000,
        myAttendance: byMeeting.get(m.id) ?? null,
      })),
    });
  } catch (error) {
    serverError(res, "listMyMeetings", "Failed to load meetings", error);
  }
};

// GET /api/student/meetings/:meetingId/join
// Records attendance for the signed-in student, then redirects to the real link.
export const joinMeeting = async (req: AuthRequest, res: Response) => {
  try {
    const meetingId = String(req.params.meetingId);
    const userId = req.user!.id;

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, courseId: true, link: true },
    });
    if (!meeting) return fail(res, 404, "Meeting not found");

    const membership = await activeEnrollment(meeting.courseId, userId);
    if (!membership.ok) return fail(res, 403, membership.message);

    const enrolled = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId: meeting.courseId } },
      select: { id: true },
    });
    if (!enrolled) return fail(res, 403, "You are not enrolled in this course");

    await prisma.attendanceRecord.upsert({
      where: { meetingId_studentId: { meetingId, studentId: userId } },
      create: {
        meetingId,
        studentId: userId,
        source: "LINK_CLICK",
        ipHash: hashIp(requestIp(req)),
      },
      update: {},
    });

    // The stored link was validated as absolute http(s) on write.
    res.redirect(302, meeting.link);
  } catch (error) {
    serverError(res, "joinMeeting", "Failed to join the meeting", error);
  }
};
