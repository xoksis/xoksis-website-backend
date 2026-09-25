import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import {
  answerMatches,
  activeEnrollment,
  fail,
  optionalDate,
  optionalInt,
  optionalText,
  serverError,
  text,
} from "../utils/lmsHttp";
import { courseAudience, notifyUser, notifyUsers } from "../utils/notify";
import { recordAudit } from "../utils/auditLog";

const QUESTION_TYPES = ["MCQ", "TRUE_FALSE", "SHORT", "LONG"] as const;

/** Seconds a student is given past the limit before the attempt is force-submitted. */
const TIME_GRACE_SECONDS = 60;

const QUIZ_SELECT = {
  id: true,
  courseId: true,
  title: true,
  description: true,
  timeLimitMin: true,
  attemptsAllowed: true,
  dueAt: true,
  shuffleQuestions: true,
  published: true,
  createdAt: true,
  updatedAt: true,
} as const;

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T[number]) : null;
}

/** Quiz ids are not course-scoped in the URL, so membership is checked here. */
async function quizInCourse(quizId: string, courseId: string) {
  return prisma.quiz.findFirst({ where: { id: quizId, courseId }, select: { id: true } });
}

function questionData(body: Record<string, unknown> | undefined, partial: boolean) {
  const data: {
    prompt?: string;
    type?: string;
    options?: string[];
    correctAnswer?: string | null;
    points?: number;
    order?: number;
  } = {};
  const problems: string[] = [];

  if (!partial || body?.prompt !== undefined) {
    const prompt = text(body?.prompt, 2000);
    if (!prompt) problems.push("Question prompt is required (max 2000 characters)");
    else data.prompt = prompt;
  }

  if (!partial || body?.type !== undefined) {
    const type = oneOf(body?.type, QUESTION_TYPES);
    if (!type) problems.push(`Question type must be one of: ${QUESTION_TYPES.join(", ")}`);
    else data.type = type;
  }

  if (body?.options !== undefined) {
    if (body.options === null) {
      data.options = [];
    } else if (!Array.isArray(body.options)) {
      problems.push("Options must be an array of strings");
    } else {
      const options = body.options
        .map((o) => text(o, 500))
        .filter((o): o is string => o !== null);
      if (options.length !== body.options.length) problems.push("Each option must be 1-500 characters");
      else if (options.length > 20) problems.push("A question can hold at most 20 options");
      else data.options = options;
    }
  }

  if (body?.correctAnswer !== undefined) {
    if (body.correctAnswer === null || body.correctAnswer === "") data.correctAnswer = null;
    else {
      const answer = text(body.correctAnswer, 500);
      if (!answer) problems.push("Correct answer must be 1-500 characters");
      else data.correctAnswer = answer;
    }
  }

  if (body?.points !== undefined) {
    const points = optionalInt(body.points, 1, 1000);
    if (points === null || points === undefined) problems.push("Points must be between 1 and 1000");
    else data.points = points;
  }

  if (body?.order !== undefined) {
    const order = optionalInt(body.order, 0, 100000);
    if (order === null || order === undefined) problems.push("Order must be a non-negative whole number");
    else data.order = order;
  }

  return { data, problems };
}

/** Cross-field checks that only make sense once the final field values are known. */
function validateAgainstType(
  type: string,
  options: string[],
  correctAnswer: string | null | undefined,
): string | null {
  if (type === "MCQ") {
    if (options.length < 2) return "A multiple-choice question needs at least 2 options";
    if (!correctAnswer) return "A multiple-choice question needs a correct answer";
    if (!options.includes(correctAnswer)) return "The correct answer must be one of the options";
  }
  if (type === "TRUE_FALSE") {
    if (correctAnswer !== "true" && correctAnswer !== "false") {
      return "A true/false question needs a correct answer of \"true\" or \"false\"";
    }
  }
  if (type === "SHORT" && !correctAnswer) {
    return "A short-answer question needs a correct answer for auto-grading, or use the Essay type";
  }
  return null;
}

// ── Teacher: quiz authoring ──────────────────────────────────────────────────

// GET /api/teacher/courses/:courseId/quizzes
export const listQuizzes = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizzes = await prisma.quiz.findMany({
      where: { courseId },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      select: {
        ...QUIZ_SELECT,
        questions: { select: { points: true, type: true } },
        _count: { select: { attempts: true } },
      },
    });

    const submitted = await prisma.quizAttempt.groupBy({
      by: ["quizId"],
      where: { quiz: { courseId }, submittedAt: { not: null } },
      _count: { _all: true },
    });
    const submittedByQuiz = new Map(submitted.map((s) => [s.quizId, s._count._all]));

    res.json({
      quizzes: quizzes.map(({ questions, _count, ...q }) => ({
        ...q,
        questionCount: questions.length,
        totalPoints: questions.reduce((sum, qq) => sum + qq.points, 0),
        manualQuestionCount: questions.filter((qq) => qq.type === "LONG").length,
        attemptCount: _count.attempts,
        submittedCount: submittedByQuiz.get(q.id) ?? 0,
      })),
    });
  } catch (error) {
    serverError(res, "listQuizzes", "Failed to load quizzes", error);
  }
};

// GET /api/teacher/courses/:courseId/quizzes/:quizId — includes correctAnswer.
export const getQuiz = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);
    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, courseId },
      select: {
        ...QUIZ_SELECT,
        questions: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!quiz) return fail(res, 404, "Quiz not found in this course");
    res.json(quiz);
  } catch (error) {
    serverError(res, "getQuiz", "Failed to load quiz", error);
  }
};

// POST /api/teacher/courses/:courseId/quizzes
export const createQuiz = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);

    const title = text(req.body?.title, 200);
    if (!title) return fail(res, 400, "Quiz title is required (max 200 characters)");

    const description = optionalText(req.body?.description, 5000);
    if (description === null) return fail(res, 400, "Description is too long (max 5000 characters)");

    const dueAt = optionalDate(req.body?.dueAt);
    if (dueAt === null) return fail(res, 400, "Due date is not a valid date");

    const timeLimitMin = optionalInt(req.body?.timeLimitMin, 1, 600);
    if (timeLimitMin === null) return fail(res, 400, "Time limit must be between 1 and 600 minutes");

    const attemptsAllowed = optionalInt(req.body?.attemptsAllowed, 1, 20);
    if (attemptsAllowed === null) return fail(res, 400, "Attempts allowed must be between 1 and 20");

    const created = await prisma.quiz.create({
      data: {
        courseId,
        title,
        description,
        dueAt,
        timeLimitMin,
        attemptsAllowed: attemptsAllowed ?? 1,
        shuffleQuestions: req.body?.shuffleQuestions === true,
        published: req.body?.published !== false,
        createdById: req.user!.id,
      },
      select: QUIZ_SELECT,
    });

    if (created.published) {
      const audience = await courseAudience(courseId);
      notifyUsers(
        audience,
        "New quiz",
        `${created.title}${created.dueAt ? ` — due ${created.dueAt.toDateString()}` : ""}`,
      );
    }

    res.status(201).json(created);
  } catch (error) {
    serverError(res, "createQuiz", "Failed to create quiz", error);
  }
};

// PUT /api/teacher/courses/:courseId/quizzes/:quizId
export const updateQuiz = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);
    if (!(await quizInCourse(quizId, courseId))) {
      return fail(res, 404, "Quiz not found in this course");
    }

    const data: {
      title?: string;
      description?: string | null;
      dueAt?: Date | null;
      timeLimitMin?: number | null;
      attemptsAllowed?: number;
      shuffleQuestions?: boolean;
      published?: boolean;
    } = {};

    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 200);
      if (!title) return fail(res, 400, "Title cannot be empty (max 200 characters)");
      data.title = title;
    }
    if (req.body?.description !== undefined) {
      const description = optionalText(req.body.description, 5000);
      if (description === null) return fail(res, 400, "Description is too long (max 5000 characters)");
      data.description = description ?? null;
    }
    if (req.body?.dueAt !== undefined) {
      const dueAt = optionalDate(req.body.dueAt);
      if (dueAt === null) return fail(res, 400, "Due date is not a valid date");
      data.dueAt = dueAt ?? null;
    }
    if (req.body?.timeLimitMin !== undefined) {
      if (req.body.timeLimitMin === null || req.body.timeLimitMin === "") data.timeLimitMin = null;
      else {
        const timeLimitMin = optionalInt(req.body.timeLimitMin, 1, 600);
        if (timeLimitMin === null || timeLimitMin === undefined) {
          return fail(res, 400, "Time limit must be between 1 and 600 minutes");
        }
        data.timeLimitMin = timeLimitMin;
      }
    }
    if (req.body?.attemptsAllowed !== undefined) {
      const attemptsAllowed = optionalInt(req.body.attemptsAllowed, 1, 20);
      if (attemptsAllowed === null || attemptsAllowed === undefined) {
        return fail(res, 400, "Attempts allowed must be between 1 and 20");
      }
      data.attemptsAllowed = attemptsAllowed;
    }
    if (req.body?.shuffleQuestions !== undefined) {
      if (typeof req.body.shuffleQuestions !== "boolean") {
        return fail(res, 400, "shuffleQuestions must be true or false");
      }
      data.shuffleQuestions = req.body.shuffleQuestions;
    }
    if (req.body?.published !== undefined) {
      if (typeof req.body.published !== "boolean") return fail(res, 400, "published must be true or false");
      data.published = req.body.published;
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const updated = await prisma.quiz.update({ where: { id: quizId }, data, select: QUIZ_SELECT });
    res.json(updated);
  } catch (error) {
    serverError(res, "updateQuiz", "Failed to update quiz", error);
  }
};

// DELETE /api/teacher/courses/:courseId/quizzes/:quizId
export const deleteQuiz = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);
    if (!(await quizInCourse(quizId, courseId))) {
      return fail(res, 404, "Quiz not found in this course");
    }
    await prisma.quiz.delete({ where: { id: quizId } });
    res.json({ message: "Quiz deleted", id: quizId });
  } catch (error) {
    serverError(res, "deleteQuiz", "Failed to delete quiz", error);
  }
};

// POST /api/teacher/courses/:courseId/quizzes/:quizId/questions
export const createQuestion = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);
    if (!(await quizInCourse(quizId, courseId))) {
      return fail(res, 404, "Quiz not found in this course");
    }

    const { data, problems } = questionData(req.body, false);
    if (problems.length) return fail(res, 400, problems[0]);

    const type = data.type!;
    const options = data.options ?? [];
    const validation = validateAgainstType(type, options, data.correctAnswer);
    if (validation) return fail(res, 400, validation);

    const last = await prisma.quizQuestion.findFirst({
      where: { quizId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const created = await prisma.quizQuestion.create({
      data: {
        quizId,
        prompt: data.prompt!,
        type,
        options,
        correctAnswer: type === "LONG" ? null : (data.correctAnswer ?? null),
        points: data.points ?? 1,
        order: data.order ?? (last ? last.order + 1 : 0),
      },
    });
    res.status(201).json(created);
  } catch (error) {
    serverError(res, "createQuestion", "Failed to add the question", error);
  }
};

// PUT /api/teacher/courses/:courseId/quizzes/:quizId/questions/:questionId
export const updateQuestion = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);
    const questionId = String(req.params.questionId);
    if (!(await quizInCourse(quizId, courseId))) {
      return fail(res, 404, "Quiz not found in this course");
    }

    const existing = await prisma.quizQuestion.findFirst({
      where: { id: questionId, quizId },
    });
    if (!existing) return fail(res, 404, "Question not found in this quiz");

    const { data, problems } = questionData(req.body, true);
    if (problems.length) return fail(res, 400, problems[0]);
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const type = data.type ?? existing.type;
    const options = data.options ?? existing.options;
    const correctAnswer =
      data.correctAnswer !== undefined ? data.correctAnswer : existing.correctAnswer;
    const validation = validateAgainstType(type, options, correctAnswer);
    if (validation) return fail(res, 400, validation);

    const updated = await prisma.quizQuestion.update({
      where: { id: questionId },
      data: { ...data, type, correctAnswer: type === "LONG" ? null : correctAnswer },
    });
    res.json(updated);
  } catch (error) {
    serverError(res, "updateQuestion", "Failed to update the question", error);
  }
};

// DELETE /api/teacher/courses/:courseId/quizzes/:quizId/questions/:questionId
export const deleteQuestion = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);
    const questionId = String(req.params.questionId);
    if (!(await quizInCourse(quizId, courseId))) {
      return fail(res, 404, "Quiz not found in this course");
    }
    const existing = await prisma.quizQuestion.findFirst({
      where: { id: questionId, quizId },
      select: { id: true },
    });
    if (!existing) return fail(res, 404, "Question not found in this quiz");

    await prisma.quizQuestion.delete({ where: { id: questionId } });
    res.json({ message: "Question deleted", id: questionId });
  } catch (error) {
    serverError(res, "deleteQuestion", "Failed to delete the question", error);
  }
};

// ── Teacher: results & manual grading ────────────────────────────────────────

// GET /api/teacher/courses/:courseId/quizzes/:quizId/results
// Every enrolled student, with their best attempt and how many they have used.
export const getQuizResults = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);

    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, courseId },
      select: {
        ...QUIZ_SELECT,
        questions: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { id: true, prompt: true, type: true, points: true, correctAnswer: true },
        },
      },
    });
    if (!quiz) return fail(res, 404, "Quiz not found in this course");

    const [enrollments, attempts] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId, applicationStatus: "APPROVED" },
        orderBy: { createdAt: "desc" },
        select: { accessStatus: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
      }),
      prisma.quizAttempt.findMany({
        where: { quizId },
        orderBy: [{ submittedAt: "desc" }, { startedAt: "desc" }],
        select: {
          id: true,
          studentId: true,
          startedAt: true,
          submittedAt: true,
          autoScore: true,
          manualScore: true,
          finalScore: true,
          maxScore: true,
          feedback: true,
          gradedById: true,
          answers: true,
        },
      }),
    ]);

    const byStudent = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const list = byStudent.get(attempt.studentId) ?? [];
      list.push(attempt);
      byStudent.set(attempt.studentId, list);
    }

    res.json({
      quiz,
      roster: enrollments.map((e) => {
        const mine = byStudent.get(e.user.id) ?? [];
        const graded = mine.filter((a) => a.finalScore !== null);
        const best = graded.reduce<(typeof graded)[number] | null>(
          (top, a) => (!top || (a.finalScore ?? 0) > (top.finalScore ?? 0) ? a : top),
          null,
        );
        return {
          student: e.user,
          accessStatus: e.accessStatus,
          attemptsUsed: mine.filter((a) => a.submittedAt !== null).length,
          inProgressAttemptId: mine.find((a) => a.submittedAt === null)?.id ?? null,
          bestAttempt: best,
          attempts: mine,
        };
      }),
    });
  } catch (error) {
    serverError(res, "getQuizResults", "Failed to load quiz results", error);
  }
};

// PUT /api/teacher/courses/:courseId/quizzes/:quizId/attempts/:attemptId/grade
// Only essay (LONG) questions are graded by hand; the rest is already scored.
export const gradeQuizAttempt = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const quizId = String(req.params.quizId);
    const attemptId = String(req.params.attemptId);
    if (!(await quizInCourse(quizId, courseId))) {
      return fail(res, 404, "Quiz not found in this course");
    }

    const [attempt, questions] = await Promise.all([
      prisma.quizAttempt.findFirst({
        where: { id: attemptId, quizId },
        select: { id: true, submittedAt: true, autoScore: true, maxScore: true },
      }),
      prisma.quizQuestion.findMany({
        where: { quizId },
        select: { points: true, type: true },
      }),
    ]);
    if (!attempt) return fail(res, 404, "Attempt not found for this quiz");
    if (!attempt.submittedAt) return fail(res, 400, "This attempt has not been submitted yet");

    const essayMax = questions
      .filter((q) => q.type === "LONG")
      .reduce((sum, q) => sum + q.points, 0);

    const manualScore = optionalInt(req.body?.manualScore, 0, essayMax || 10000);
    if (manualScore === null || manualScore === undefined) {
      return fail(res, 400, `Manual score must be a whole number between 0 and ${essayMax}`);
    }
    const feedback = optionalText(req.body?.feedback, 2000);
    if (feedback === null) return fail(res, 400, "Feedback is too long (max 2000 characters)");

    const updated = await prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        manualScore,
        finalScore: (attempt.autoScore ?? 0) + manualScore,
        feedback: feedback ?? null,
        gradedById: req.user!.id,
      },
      select: {
        id: true,
        studentId: true,
        autoScore: true,
        manualScore: true,
        finalScore: true,
        maxScore: true,
        feedback: true,
      },
    });

    notifyUser(
      updated.studentId,
      "Quiz graded",
      `Your quiz result is ready: ${updated.finalScore}/${updated.maxScore}.`,
    );
    recordAudit(req.user!.id, "quizAttempt.grade", "QuizAttempt", attemptId, {
      quizId,
      manualScore,
    });
    res.json(updated);
  } catch (error) {
    serverError(res, "gradeQuizAttempt", "Failed to save the quiz grade", error);
  }
};

// ── Student ──────────────────────────────────────────────────────────────────

/** Strips correctAnswer/options-for-non-MCQ before anything reaches a student. */
function publicQuestion(q: {
  id: string;
  prompt: string;
  type: string;
  options: string[];
  points: number;
  order: number;
}) {
  return {
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    options: q.type === "MCQ" ? q.options : q.type === "TRUE_FALSE" ? ["true", "false"] : [],
    points: q.points,
    order: q.order,
  };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// GET /api/student/courses/:courseId/quizzes
export const listMyQuizzes = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const userId = req.user!.id;

    const [quizzes, attempts] = await Promise.all([
      prisma.quiz.findMany({
        where: { courseId, published: true },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        select: {
          ...QUIZ_SELECT,
          questions: { select: { points: true, type: true } },
        },
      }),
      prisma.quizAttempt.findMany({
        where: { studentId: userId, quiz: { courseId } },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          quizId: true,
          startedAt: true,
          submittedAt: true,
          autoScore: true,
          manualScore: true,
          finalScore: true,
          maxScore: true,
          feedback: true,
        },
      }),
    ]);

    const byQuiz = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const list = byQuiz.get(attempt.quizId) ?? [];
      list.push(attempt);
      byQuiz.set(attempt.quizId, list);
    }

    res.json({
      quizzes: quizzes.map(({ questions, ...q }) => {
        const mine = byQuiz.get(q.id) ?? [];
        const inProgress = mine.find((a) => a.submittedAt === null) ?? null;
        return {
          ...q,
          questionCount: questions.length,
          totalPoints: questions.reduce((sum, qq) => sum + qq.points, 0),
          attemptsUsed: mine.filter((a) => a.submittedAt !== null).length,
          bestScore: mine.reduce<number | null>(
            (best, a) => (a.finalScore !== null && (best === null || a.finalScore > best) ? a.finalScore : best),
            null,
          ),
          inProgressAttemptId: inProgress?.id ?? null,
          attempts: mine,
        };
      }),
    });
  } catch (error) {
    serverError(res, "listMyQuizzes", "Failed to load quizzes", error);
  }
};

// POST /api/student/quizzes/:quizId/attempts — start (or resume) an attempt.
export const startAttempt = async (req: AuthRequest, res: Response) => {
  try {
    const quizId = String(req.params.quizId);
    const userId = req.user!.id;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        ...QUIZ_SELECT,
        questions: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { id: true, prompt: true, type: true, options: true, points: true, order: true },
        },
      },
    });
    if (!quiz || !quiz.published) return fail(res, 404, "Quiz not found");
    if (quiz.questions.length === 0) return fail(res, 400, "This quiz has no questions yet");

    const membership = await activeEnrollment(quiz.courseId, userId);
    if (!membership.ok) return fail(res, 403, membership.message);

    if (quiz.dueAt && Date.now() > quiz.dueAt.getTime()) {
      return fail(res, 400, "The deadline for this quiz has passed");
    }

    const existing = await prisma.quizAttempt.findMany({
      where: { quizId, studentId: userId },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true, submittedAt: true, answers: true },
    });

    const inProgress = existing.find((a) => a.submittedAt === null);
    if (inProgress) {
      const elapsed = Math.floor((Date.now() - inProgress.startedAt.getTime()) / 1000);
      const limit = quiz.timeLimitMin ? quiz.timeLimitMin * 60 : null;
      if (limit !== null && elapsed > limit + TIME_GRACE_SECONDS) {
        const graded = await finaliseAttempt(inProgress.id);
        return res.json({ submitted: true, attempt: graded, quiz: publicQuiz(quiz) });
      }
      return res.json({
        submitted: false,
        attempt: {
          id: inProgress.id,
          startedAt: inProgress.startedAt,
          answers: inProgress.answers ?? {},
        },
        secondsRemaining: limit === null ? null : Math.max(0, limit - elapsed),
        quiz: publicQuiz(quiz),
      });
    }

    const used = existing.filter((a) => a.submittedAt !== null).length;
    if (used >= quiz.attemptsAllowed) {
      return fail(res, 400, `You have used all ${quiz.attemptsAllowed} attempt(s) for this quiz`);
    }

    const attempt = await prisma.quizAttempt.create({
      data: { quizId, studentId: userId, maxScore: totalPoints(quiz.questions) },
      select: { id: true, startedAt: true },
    });

    res.status(201).json({
      submitted: false,
      attempt: { id: attempt.id, startedAt: attempt.startedAt, answers: {} },
      secondsRemaining: quiz.timeLimitMin ? quiz.timeLimitMin * 60 : null,
      quiz: publicQuiz(quiz),
    });
  } catch (error) {
    serverError(res, "startAttempt", "Failed to start the quiz", error);
  }
};

function totalPoints(questions: { points: number }[]) {
  return questions.reduce((sum, q) => sum + q.points, 0);
}

function publicQuiz(quiz: {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  timeLimitMin: number | null;
  attemptsAllowed: number;
  dueAt: Date | null;
  shuffleQuestions: boolean;
  questions: { id: string; prompt: string; type: string; options: string[]; points: number; order: number }[];
}) {
  const questions = quiz.shuffleQuestions ? shuffle(quiz.questions) : quiz.questions;
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    title: quiz.title,
    description: quiz.description,
    timeLimitMin: quiz.timeLimitMin,
    attemptsAllowed: quiz.attemptsAllowed,
    dueAt: quiz.dueAt,
    questions: questions.map(publicQuestion),
  };
}

// GET /api/student/attempts/:attemptId — resume state for the timer.
export const getAttempt = async (req: AuthRequest, res: Response) => {
  try {
    const attemptId = String(req.params.attemptId);
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        studentId: true,
        startedAt: true,
        submittedAt: true,
        answers: true,
        autoScore: true,
        manualScore: true,
        finalScore: true,
        maxScore: true,
        feedback: true,
        quiz: {
          select: {
            id: true,
            courseId: true,
            title: true,
            description: true,
            timeLimitMin: true,
            attemptsAllowed: true,
            dueAt: true,
            shuffleQuestions: true,
            questions: {
              orderBy: [{ order: "asc" }, { createdAt: "asc" }],
              select: { id: true, prompt: true, type: true, options: true, points: true, order: true },
            },
          },
        },
      },
    });
    if (!attempt || attempt.studentId !== req.user!.id) {
      return fail(res, 404, "Attempt not found");
    }

    const elapsed = Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000);
    const limit = attempt.quiz.timeLimitMin ? attempt.quiz.timeLimitMin * 60 : null;

    res.json({
      id: attempt.id,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      answers: attempt.answers ?? {},
      autoScore: attempt.autoScore,
      manualScore: attempt.manualScore,
      finalScore: attempt.finalScore,
      maxScore: attempt.maxScore,
      feedback: attempt.feedback,
      secondsRemaining:
        attempt.submittedAt || limit === null
          ? null
          : Math.max(0, limit + TIME_GRACE_SECONDS - elapsed),
      quiz: publicQuiz(attempt.quiz),
    });
  } catch (error) {
    serverError(res, "getAttempt", "Failed to load the attempt", error);
  }
};

// PATCH /api/student/attempts/:attemptId — autosave answers mid-quiz.
export const saveAttempt = async (req: AuthRequest, res: Response) => {
  try {
    const attemptId = String(req.params.attemptId);
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, studentId: true, submittedAt: true },
    });
    if (!attempt || attempt.studentId !== req.user!.id) return fail(res, 404, "Attempt not found");
    if (attempt.submittedAt) return fail(res, 400, "This attempt has already been submitted");

    const answers = req.body?.answers;
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
      return fail(res, 400, "Answers must be an object keyed by question id");
    }

    await prisma.quizAttempt.update({ where: { id: attemptId }, data: { answers } });
    res.json({ message: "Saved", id: attemptId });
  } catch (error) {
    serverError(res, "saveAttempt", "Failed to save your answers", error);
  }
};

// POST /api/student/attempts/:attemptId/submit
export const submitAttempt = async (req: AuthRequest, res: Response) => {
  try {
    const attemptId = String(req.params.attemptId);
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, studentId: true, submittedAt: true },
    });
    if (!attempt || attempt.studentId !== req.user!.id) return fail(res, 404, "Attempt not found");
    if (attempt.submittedAt) return fail(res, 400, "This attempt has already been submitted");

    const answers = req.body?.answers;
    if (answers !== undefined) {
      if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
        return fail(res, 400, "Answers must be an object keyed by question id");
      }
      await prisma.quizAttempt.update({ where: { id: attemptId }, data: { answers } });
    }

    const graded = await finaliseAttempt(attemptId);
    res.json(graded);
  } catch (error) {
    serverError(res, "submitAttempt", "Failed to submit the quiz", error);
  }
};

/** Scores every auto-gradable question and closes the attempt. Idempotent. */
async function finaliseAttempt(attemptId: string) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      submittedAt: true,
      answers: true,
      quiz: {
        select: {
          questions: {
            select: { id: true, type: true, correctAnswer: true, points: true },
          },
        },
      },
    },
  });
  if (!attempt) throw new Error("Attempt not found");
  if (attempt.submittedAt) {
    return prisma.quizAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: {
        id: true,
        submittedAt: true,
        autoScore: true,
        manualScore: true,
        finalScore: true,
        maxScore: true,
        feedback: true,
      },
    });
  }

  const answers = (attempt.answers ?? {}) as Record<string, unknown>;
  const questions = attempt.quiz.questions;

  let autoScore = 0;
  for (const q of questions) {
    if (q.type === "LONG") continue;
    if (answerMatches(answers[q.id], q.correctAnswer)) autoScore += q.points;
  }

  const needsManual = questions.some((q) => q.type === "LONG");
  const maxScore = totalPoints(questions);

  return prisma.quizAttempt.update({
    where: { id: attemptId },
    data: {
      submittedAt: new Date(),
      autoScore,
      maxScore,
      manualScore: needsManual ? null : 0,
      finalScore: needsManual ? null : autoScore,
    },
    select: {
      id: true,
      submittedAt: true,
      autoScore: true,
      manualScore: true,
      finalScore: true,
      maxScore: true,
      feedback: true,
    },
  });
}
