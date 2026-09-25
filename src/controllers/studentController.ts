import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { buildCourseContentTree } from "../utils/courseContent";

const isDev = process.env.NODE_ENV !== "production";

const COURSE_CARD_SELECT = {
  id: true,
  title: true,
  desc: true,
  cat: true,
  level: true,
  image: true,
  badge: true,
  hours: true,
  teachers: {
    select: {
      role: true,
      teacher: { select: { id: true, name: true, email: true, avatar: true } },
    },
  },
  _count: { select: { modules: true, materials: true } },
} as const;

// GET /api/student/courses — every course the signed-in student is enrolled in,
// with the fee/access state the dashboard surfaces.
export const listMyCourses = async (req: AuthRequest, res: Response) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        applicationStatus: true,
        accessStatus: true,
        courseCompleted: true,
        feeTier: true,
        fee: true,
        feeStatus: true,
        createdAt: true,
        course: { select: COURSE_CARD_SELECT },
      },
    });

    res.json({ enrollments });
  } catch (error) {
    console.error("listMyCourses:", error);
    res.status(500).json({
      message: "Failed to load your courses",
      ...(isDev && error instanceof Error && { error: error.message }),
    });
  }
};

// GET /api/student/courses/:courseId — one enrolled course plus its full
// content tree. Guarded by requireEnrollment.
export const getMyCourse = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const userId = req.user!.id;

    const [course, enrollment] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId },
        select: { ...COURSE_CARD_SELECT, intro: true, prerequisites: true },
      }),
      prisma.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: {
          id: true,
          applicationStatus: true,
          accessStatus: true,
          courseCompleted: true,
          feeTier: true,
          fee: true,
          feeStatus: true,
          referrerId: true,
          createdAt: true,
        },
      }),
    ]);

    if (!course) return res.status(404).json({ message: "Course not found" });

    const content = await buildCourseContentTree(courseId);
    res.json({ course, enrollment, ...content });
  } catch (error) {
    console.error("getMyCourse:", error);
    res.status(500).json({
      message: "Failed to load course",
      ...(isDev && error instanceof Error && { error: error.message }),
    });
  }
};
