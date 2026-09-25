import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

// GET /api/teacher/courses — courses the current teacher (or admin) is assigned to.
// For admins we return every course so the admin can browse the LMS the same way.
export const listMyCourses = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === "ADMIN";

    const courses = await prisma.course.findMany({
      where: isAdmin
        ? undefined
        : { teachers: { some: { teacherId: userId } } },
      select: {
        id: true,
        title: true,
        cat: true,
        level: true,
        image: true,
        badge: true,
        createdAt: true,
        _count: {
          select: {
            enrollments: { where: { accessStatus: "active" } },
            modules: true,
            materials: true,
          },
        },
        teachers: {
          select: {
            role: true,
            teacher: { select: { id: true, name: true, email: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ courses });
  } catch (error) {
    console.error("listMyCourses:", error);
    res.status(500).json({ message: "Failed to list courses" });
  }
};

// GET /api/teacher/courses/:courseId — course details + roster.
// Guarded by teacherOwnsCourse, so we can trust access here.
export const getCourseWorkspace = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        desc: true,
        cat: true,
        level: true,
        image: true,
        badge: true,
        createdAt: true,
        teachers: {
          select: {
            role: true,
            teacher: { select: { id: true, name: true, email: true, avatar: true } },
          },
        },
      },
    });

    if (!course) return res.status(404).json({ message: "Course not found" });

    const roster = await prisma.enrollment.findMany({
      where: { courseId },
      select: {
        id: true,
        applicationStatus: true,
        accessStatus: true,
        courseCompleted: true,
        feeTier: true,
        feeStatus: true,
        fee: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ course, roster });
  } catch (error) {
    console.error("getCourseWorkspace:", error);
    res.status(500).json({ message: "Failed to load course" });
  }
};
