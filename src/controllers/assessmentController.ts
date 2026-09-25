import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { courseAudience, notifyUser, notifyUsers } from "../utils/notify";
import { recordAudit } from "../utils/auditLog";

const isDev = process.env.NODE_ENV !== "production";

function fail(res: Response, status: number, message: string, error?: unknown) {
  res.status(status).json({
    message,
    ...(isDev && error instanceof Error && { error: error.message }),
  });
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, max);
}

function optionalUrl(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const trimmed = text(value, 2048);
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function optionalInt(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function optionalDate(value: unknown): Date | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

const ASSIGNMENT_SELECT = {
  id: true,
  courseId: true,
  title: true,
  instructions: true,
  dueAt: true,
  maxPoints: true,
  allowLate: true,
  published: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Assignment ids are not course-scoped in the URL, so membership is checked here. */
async function assignmentInCourse(assignmentId: string, courseId: string) {
  return prisma.assignment.findFirst({
    where: { id: assignmentId, courseId },
    select: { id: true },
  });
}

async function activeEnrollment(courseId: string, userId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { applicationStatus: true, accessStatus: true },
  });
  if (!enrollment || enrollment.applicationStatus !== "APPROVED") {
    return { ok: false as const, message: "You are not enrolled in this course" };
  }
  if (enrollment.accessStatus !== "active") {
    return { ok: false as const, message: "Your access to this course has been revoked" };
  }
  return { ok: true as const };
}

// ── Teacher: assignment authoring ────────────────────────────────────────────

// GET /api/teacher/courses/:courseId/assignments
export const listAssignments = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const assignments = await prisma.assignment.findMany({
      where: { courseId },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      select: {
        ...ASSIGNMENT_SELECT,
        _count: { select: { submissions: true } },
      },
    });

    const graded = await prisma.submission.groupBy({
      by: ["assignmentId"],
      where: { assignment: { courseId }, grade: { not: null } },
      _count: { _all: true },
    });
    const gradedByAssignment = new Map(graded.map((g) => [g.assignmentId, g._count._all]));

    res.json({
      assignments: assignments.map((a) => ({
        ...a,
        submittedCount: a._count.submissions,
        gradedCount: gradedByAssignment.get(a.id) ?? 0,
      })),
    });
  } catch (error) {
    console.error("listAssignments:", error);
    fail(res, 500, "Failed to load assignments", error);
  }
};

// POST /api/teacher/courses/:courseId/assignments
export const createAssignment = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);

    const title = text(req.body?.title, 200);
    if (!title) return fail(res, 400, "Assignment title is required (max 200 characters)");

    const instructions = optionalText(req.body?.instructions, 10000);
    if (instructions === null) {
      return fail(res, 400, "Instructions are too long (max 10000 characters)");
    }

    const dueAt = optionalDate(req.body?.dueAt);
    if (dueAt === null) return fail(res, 400, "Due date is not a valid date");

    const maxPoints = optionalInt(req.body?.maxPoints, 1, 10000);
    if (maxPoints === null) return fail(res, 400, "Max points must be between 1 and 10000");

    const created = await prisma.assignment.create({
      data: {
        courseId,
        title,
        instructions,
        dueAt,
        maxPoints: maxPoints ?? 100,
        allowLate: req.body?.allowLate !== false,
        published: req.body?.published !== false,
        createdById: req.user!.id,
      },
      select: ASSIGNMENT_SELECT,
    });

    if (created.published) {
      const audience = await courseAudience(courseId);
      notifyUsers(
        audience,
        "New assignment",
        `${created.title}${created.dueAt ? ` — due ${created.dueAt.toDateString()}` : ""}`,
      );
    }

    res.status(201).json(created);
  } catch (error) {
    console.error("createAssignment:", error);
    fail(res, 500, "Failed to create assignment", error);
  }
};

// PUT /api/teacher/courses/:courseId/assignments/:assignmentId
export const updateAssignment = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const assignmentId = String(req.params.assignmentId);
    if (!(await assignmentInCourse(assignmentId, courseId))) {
      return fail(res, 404, "Assignment not found in this course");
    }

    const data: {
      title?: string;
      instructions?: string | null;
      dueAt?: Date | null;
      maxPoints?: number;
      allowLate?: boolean;
      published?: boolean;
    } = {};

    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 200);
      if (!title) return fail(res, 400, "Title cannot be empty (max 200 characters)");
      data.title = title;
    }
    if (req.body?.instructions !== undefined) {
      const instructions = optionalText(req.body.instructions, 10000);
      if (instructions === null) return fail(res, 400, "Instructions are too long (max 10000 characters)");
      data.instructions = instructions ?? null;
    }
    if (req.body?.dueAt !== undefined) {
      const dueAt = optionalDate(req.body.dueAt);
      if (dueAt === null) return fail(res, 400, "Due date is not a valid date");
      data.dueAt = dueAt ?? null;
    }
    if (req.body?.maxPoints !== undefined) {
      const maxPoints = optionalInt(req.body.maxPoints, 1, 10000);
      if (maxPoints === null) return fail(res, 400, "Max points must be between 1 and 10000");
      data.maxPoints = maxPoints;
    }
    if (req.body?.allowLate !== undefined) {
      if (typeof req.body.allowLate !== "boolean") return fail(res, 400, "allowLate must be true or false");
      data.allowLate = req.body.allowLate;
    }
    if (req.body?.published !== undefined) {
      if (typeof req.body.published !== "boolean") {
        return fail(res, 400, "published must be true or false");
      }
      data.published = req.body.published;
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const updated = await prisma.assignment.update({
      where: { id: assignmentId },
      data,
      select: ASSIGNMENT_SELECT,
    });
    res.json(updated);
  } catch (error) {
    console.error("updateAssignment:", error);
    fail(res, 500, "Failed to update assignment", error);
  }
};

// DELETE /api/teacher/courses/:courseId/assignments/:assignmentId
export const deleteAssignment = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const assignmentId = String(req.params.assignmentId);
    if (!(await assignmentInCourse(assignmentId, courseId))) {
      return fail(res, 404, "Assignment not found in this course");
    }
    await prisma.assignment.delete({ where: { id: assignmentId } });
    res.json({ message: "Assignment deleted", id: assignmentId });
  } catch (error) {
    console.error("deleteAssignment:", error);
    fail(res, 500, "Failed to delete assignment", error);
  }
};

// ── Teacher: grading ─────────────────────────────────────────────────────────

// GET /api/teacher/courses/:courseId/assignments/:assignmentId/submissions
// Returns every enrolled student, with their submission when one exists.
export const getAssignmentSubmissions = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const assignmentId = String(req.params.assignmentId);

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
      select: ASSIGNMENT_SELECT,
    });
    if (!assignment) return fail(res, 404, "Assignment not found in this course");

    const [enrollments, submissions] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId, applicationStatus: "APPROVED" },
        orderBy: { createdAt: "desc" },
        select: {
          accessStatus: true,
          user: { select: { id: true, name: true, email: true, avatar: true } },
        },
      }),
      prisma.submission.findMany({
        where: { assignmentId },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          studentId: true,
          text: true,
          url: true,
          isLate: true,
          submittedAt: true,
          grade: true,
          feedback: true,
          gradedAt: true,
          gradedById: true,
        },
      }),
    ]);

    const byStudent = new Map(submissions.map((s) => [s.studentId, s]));

    res.json({
      assignment,
      roster: enrollments.map((e) => ({
        student: e.user,
        accessStatus: e.accessStatus,
        submission: byStudent.get(e.user.id) ?? null,
      })),
    });
  } catch (error) {
    console.error("getAssignmentSubmissions:", error);
    fail(res, 500, "Failed to load submissions", error);
  }
};

// PUT /api/teacher/courses/:courseId/assignments/:assignmentId/submissions/:studentId/grade
export const gradeSubmission = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const assignmentId = String(req.params.assignmentId);
    const studentId = String(req.params.studentId);

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
      select: { id: true, title: true, maxPoints: true },
    });
    if (!assignment) return fail(res, 404, "Assignment not found in this course");

    const submission = await prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      select: { id: true },
    });
    if (!submission) return fail(res, 404, "This student has not submitted anything yet");

    const grade = optionalInt(req.body?.grade, 0, assignment.maxPoints);
    if (grade === null || grade === undefined) {
      return fail(res, 400, `Grade must be a whole number between 0 and ${assignment.maxPoints}`);
    }
    const feedback = optionalText(req.body?.feedback, 2000);
    if (feedback === null) return fail(res, 400, "Feedback is too long (max 2000 characters)");

    const updated = await prisma.submission.update({
      where: { id: submission.id },
      data: {
        grade,
        feedback: feedback ?? null,
        gradedAt: new Date(),
        gradedById: req.user!.id,
      },
      select: {
        id: true,
        studentId: true,
        grade: true,
        feedback: true,
        gradedAt: true,
        isLate: true,
      },
    });

    notifyUser(
      updated.studentId,
      "Assignment graded",
      `${assignment.title}: ${updated.grade}/${assignment.maxPoints}`,
    );
    recordAudit(req.user!.id, "submission.grade", "Submission", submission.id, {
      assignmentId,
      studentId,
      grade,
    });
    res.json(updated);
  } catch (error) {
    console.error("gradeSubmission:", error);
    fail(res, 500, "Failed to save the grade", error);
  }
};

// ── Student ──────────────────────────────────────────────────────────────────

// GET /api/student/courses/:courseId/assignments
export const listMyAssignments = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);

    const [assignments, submissions] = await Promise.all([
      prisma.assignment.findMany({
        where: { courseId, published: true },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        select: ASSIGNMENT_SELECT,
      }),
      prisma.submission.findMany({
        where: { studentId: req.user!.id, assignment: { courseId } },
        select: {
          id: true,
          assignmentId: true,
          text: true,
          url: true,
          isLate: true,
          submittedAt: true,
          grade: true,
          feedback: true,
          gradedAt: true,
        },
      }),
    ]);

    const byAssignment = new Map(submissions.map((s) => [s.assignmentId, s]));
    res.json({
      assignments: assignments.map((a) => ({
        ...a,
        submission: byAssignment.get(a.id) ?? null,
      })),
    });
  } catch (error) {
    console.error("listMyAssignments:", error);
    fail(res, 500, "Failed to load assignments", error);
  }
};

// POST /api/student/assignments/:assignmentId/submissions
// Creates or replaces the caller's own submission.
export const submitAssignment = async (req: AuthRequest, res: Response) => {
  try {
    const assignmentId = String(req.params.assignmentId);
    const userId = req.user!.id;

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, courseId: true, dueAt: true, allowLate: true, published: true },
    });
    if (!assignment || !assignment.published) {
      return fail(res, 404, "Assignment not found");
    }

    const membership = await activeEnrollment(assignment.courseId, userId);
    if (!membership.ok) return fail(res, 403, membership.message);

    const body = optionalText(req.body?.text, 20000);
    if (body === null) return fail(res, 400, "Your answer is too long (max 20000 characters)");
    const link = optionalUrl(req.body?.url);
    if (link === null) return fail(res, 400, "Attachment link must be a valid http(s) URL");

    if (!body && !link) {
      return fail(res, 400, "Add an answer or a link before submitting");
    }

    const existing = await prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: userId } },
      select: { id: true, grade: true },
    });
    if (existing && existing.grade !== null) {
      return fail(res, 400, "This submission has already been graded and can no longer be changed");
    }

    const isLate = !!assignment.dueAt && Date.now() > assignment.dueAt.getTime();
    if (isLate && !assignment.allowLate) {
      return fail(res, 400, "The deadline has passed and this assignment does not accept late work");
    }

    const saved = await prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId: userId } },
      create: {
        assignmentId,
        studentId: userId,
        text: body ?? null,
        url: link ?? null,
        isLate,
        submittedAt: new Date(),
      },
      update: {
        text: body ?? null,
        url: link ?? null,
        isLate,
        submittedAt: new Date(),
      },
      select: {
        id: true,
        assignmentId: true,
        text: true,
        url: true,
        isLate: true,
        submittedAt: true,
        grade: true,
        feedback: true,
      },
    });

    res.status(existing ? 200 : 201).json(saved);
  } catch (error) {
    console.error("submitAssignment:", error);
    fail(res, 500, "Failed to submit your work", error);
  }
};
