import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { fail, serverError } from "../utils/lmsHttp";
import { issueCertificate } from "./progressController";

// GET /api/teacher/courses/:courseId/gradebook
// Students × items matrix. Assignments and quizzes are the columns, so a
// teacher can read and edit a whole class on one screen.
export const getGradebook = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true },
    });
    if (!course) return fail(res, 404, "Course not found");

    const [enrollments, assignments, quizzes, submissions, attempts, lessonTotal, completions] =
      await Promise.all([
        prisma.enrollment.findMany({
          where: { courseId, applicationStatus: "APPROVED" },
          orderBy: { createdAt: "desc" },
          select: {
            accessStatus: true,
            courseCompleted: true,
            user: { select: { id: true, name: true, email: true, avatar: true } },
          },
        }),
        prisma.assignment.findMany({
          where: { courseId },
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
          select: { id: true, title: true, maxPoints: true, dueAt: true, published: true },
        }),
        prisma.quiz.findMany({
          where: { courseId },
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            dueAt: true,
            published: true,
            questions: { select: { points: true } },
          },
        }),
        prisma.submission.findMany({
          where: { assignment: { courseId } },
          select: {
            assignmentId: true,
            studentId: true,
            grade: true,
            isLate: true,
            submittedAt: true,
            gradedAt: true,
          },
        }),
        prisma.quizAttempt.findMany({
          where: { quiz: { courseId }, submittedAt: { not: null } },
          select: {
            quizId: true,
            studentId: true,
            finalScore: true,
            maxScore: true,
            submittedAt: true,
          },
        }),
        prisma.lesson.count({ where: { module: { courseId } } }),
        prisma.lessonCompletion.groupBy({
          by: ["studentId"],
          where: { lesson: { module: { courseId } } },
          _count: { _all: true },
        }),
      ]);

    const submissionByKey = new Map(submissions.map((s) => [`${s.studentId}:${s.assignmentId}`, s]));
    const bestAttempt = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts) {
      const key = `${a.studentId}:${a.quizId}`;
      const current = bestAttempt.get(key);
      if (!current || (a.finalScore ?? -1) > (current.finalScore ?? -1)) bestAttempt.set(key, a);
    }
    const completedByStudent = new Map(completions.map((c) => [c.studentId, c._count._all]));

    const items = [
      ...assignments.map((a) => ({
        kind: "ASSIGNMENT" as const,
        id: a.id,
        title: a.title,
        maxPoints: a.maxPoints,
        dueAt: a.dueAt,
        published: a.published,
      })),
      ...quizzes.map((q) => ({
        kind: "QUIZ" as const,
        id: q.id,
        title: q.title,
        maxPoints: q.questions.reduce((sum, qq) => sum + qq.points, 0),
        dueAt: q.dueAt,
        published: q.published,
      })),
    ];

    const students = enrollments.map((e) => {
      const cells: Record<
        string,
        {
          score: number | null;
          maxScore: number;
          submittedAt: Date | null;
          isLate: boolean;
          graded: boolean;
        }
      > = {};
      let earned = 0;
      let possible = 0;
      let gradedItems = 0;

      for (const item of items) {
        if (item.kind === "ASSIGNMENT") {
          const s = submissionByKey.get(`${e.user.id}:${item.id}`);
          cells[item.id] = {
            score: s?.grade ?? null,
            maxScore: item.maxPoints,
            submittedAt: s?.submittedAt ?? null,
            isLate: s?.isLate ?? false,
            graded: s?.grade !== null && s?.grade !== undefined,
          };
          if (s?.grade !== null && s?.grade !== undefined) {
            earned += s.grade;
            possible += item.maxPoints;
            gradedItems += 1;
          }
        } else {
          const a = bestAttempt.get(`${e.user.id}:${item.id}`);
          cells[item.id] = {
            score: a?.finalScore ?? null,
            maxScore: a?.maxScore ?? item.maxPoints,
            submittedAt: a?.submittedAt ?? null,
            isLate: false,
            graded: a?.finalScore !== null && a?.finalScore !== undefined,
          };
          if (a?.finalScore !== null && a?.finalScore !== undefined) {
            earned += a.finalScore;
            possible += a.maxScore;
            gradedItems += 1;
          }
        }
      }

      const done = completedByStudent.get(e.user.id) ?? 0;
      return {
        student: e.user,
        accessStatus: e.accessStatus,
        courseCompleted: e.courseCompleted,
        cells,
        pointsEarned: earned,
        pointsPossible: possible,
        percent: possible === 0 ? null : Math.round((earned / possible) * 100),
        gradedItems,
        lessonsCompleted: done,
        lessonsTotal: lessonTotal,
        progressPercent: lessonTotal === 0 ? 0 : Math.round((done / lessonTotal) * 100),
      };
    });

    res.json({ course, items, students });
  } catch (error) {
    serverError(res, "getGradebook", "Failed to load the gradebook", error);
  }
};

// GET /api/teacher/courses/:courseId/analytics
export const getCourseAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);

    const [
      enrolled,
      active,
      completed,
      submissions,
      gradedSubmissions,
      lessonTotal,
      completions,
      meetings,
      attendance,
    ] = await Promise.all([
      prisma.enrollment.count({ where: { courseId, applicationStatus: "APPROVED" } }),
      prisma.enrollment.count({
        where: { courseId, applicationStatus: "APPROVED", accessStatus: "active" },
      }),
      prisma.enrollment.count({ where: { courseId, courseCompleted: true } }),
      prisma.submission.count({ where: { assignment: { courseId } } }),
      prisma.submission.count({ where: { assignment: { courseId }, grade: { not: null } } }),
      prisma.lesson.count({ where: { module: { courseId } } }),
      prisma.lessonCompletion.count({ where: { lesson: { module: { courseId } } } }),
      prisma.meeting.count({ where: { courseId } }),
      prisma.attendanceRecord.count({ where: { meeting: { courseId } } }),
    ]);

    const possibleCompletions = enrolled * lessonTotal;
    const possibleAttendance = enrolled * meetings;

    res.json({
      students: {
        enrolled,
        active,
        completed,
        completionRate: enrolled === 0 ? 0 : Math.round((completed / enrolled) * 100),
      },
      assignments: {
        submissions,
        graded: gradedSubmissions,
        awaitingGrade: submissions - gradedSubmissions,
      },
      content: {
        lessonsTotal: lessonTotal,
        lessonsCompleted: completions,
        engagementPercent:
          possibleCompletions === 0 ? 0 : Math.round((completions / possibleCompletions) * 100),
      },
      attendance: {
        meetings,
        records: attendance,
        rate: possibleAttendance === 0 ? 0 : Math.round((attendance / possibleAttendance) * 100),
      },
    });
  } catch (error) {
    serverError(res, "getCourseAnalytics", "Failed to load analytics", error);
  }
};

// POST /api/teacher/courses/:courseId/students/:studentId/certificate
export const issueStudentCertificate = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const studentId = String(req.params.studentId);

    const enrolled = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: studentId, courseId } },
      select: { id: true },
    });
    if (!enrolled) return fail(res, 404, "That student is not enrolled in this course");

    const certificate = await issueCertificate(courseId, studentId);
    res.status(201).json(certificate);
  } catch (error) {
    serverError(res, "issueStudentCertificate", "Failed to issue the certificate", error);
  }
};
