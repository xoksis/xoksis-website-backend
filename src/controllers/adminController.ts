import { Request, Response } from "express";
import prisma from "../config/prisma";
import { clearUserCache } from "../middleware/authMiddleware";
import { recordAudit } from "../utils/auditLog";

const isDev = process.env.NODE_ENV !== "production";

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  || "1")));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"))));
    const skip  = (page - 1) * limit;

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          avatar: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.user.count(),
    ]);

    res.json({
      users,
      totalCount,
      page,
      limit,
      hasMore: skip + users.length < totalCount,
    });
  } catch (error: any) {
    console.error("getAllUsers:", error);
    res
      .status(500)
      .json({ message: "Error fetching users", ...(isDev && { error: error.message }) });
  }
};

export const updateUserRole = async (req: Request, res: Response) => {
  const { role } = req.body;
  const userId = String(req.params.id);
  const ALLOWED_ROLES = ["USER", "ADMIN", "MENTOR"];
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ message: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(", ")}.` });
  }
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true },
    });
    // Invalidate cached user so role change takes effect immediately
    clearUserCache(userId);
    recordAudit((req as Request & { user?: { id?: string } }).user?.id, "user.role.change", "User", userId, {
      role,
      email: user.email,
    });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: "Error updating user role", ...(isDev && { error: error.message }) });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const userId = String(req.params.id);
  try {
    await prisma.$transaction([
      prisma.enrollment.deleteMany({ where: { userId } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.certificate.deleteMany({ where: { userId } }),
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.feedback.deleteMany({ where: { userId } }),
      prisma.blogPost.deleteMany({ where: { authorId: userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);
    // Invalidate cache immediately after deletion
    clearUserCache(userId);
    res.json({ message: "User deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Error deleting user", ...(isDev && { error: error.message }) });
  }
};

export const getStats = async (req: any, res: Response) => {
  try {
    const [userCount, courseCount, productCount, blogCount] = await Promise.all([
      prisma.user.count(),
      prisma.course.count(),
      prisma.product.count(),
      prisma.blogPost.count(),
    ]);
    res.json({ users: userCount, courses: courseCount, products: productCount, blogs: blogCount });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching stats", ...(isDev && { error: error.message }) });
  }
};

// ── LMS: teacher assignment ──────────────────────────────────────────────────

// POST /api/admin/courses/:courseId/teachers  { teacherId, role? }
// Promotes the user to MENTOR if not already, then links them to the course.
export const assignCourseTeacher = async (req: Request, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const { teacherId, role } = req.body ?? {};
    if (!teacherId) {
      return res.status(400).json({ message: "teacherId is required" });
    }

    const [course, user] = await Promise.all([
      prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }),
      prisma.user.findUnique({
        where: { id: teacherId },
        select: { id: true, role: true, tokenVersion: true },
      }),
    ]);
    if (!course) return res.status(404).json({ message: "Course not found" });
    if (!user)   return res.status(404).json({ message: "User not found" });

    // Auto-promote a plain USER to MENTOR when first assigned to a course.
    // ADMIN stays ADMIN — admins can teach without losing admin rights.
    if (user.role === "USER") {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: "MENTOR", tokenVersion: { increment: 1 } },
      });
      clearUserCache(user.id);
    }

    const link = await prisma.courseTeacher.upsert({
      where: { courseId_teacherId: { courseId, teacherId } },
      update: { role: role === "ASSISTANT" ? "ASSISTANT" : "LEAD" },
      create: { courseId, teacherId, role: role === "ASSISTANT" ? "ASSISTANT" : "LEAD" },
      select: {
        id: true,
        role: true,
        assignedAt: true,
        teacher: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    recordAudit((req as Request & { user?: { id?: string } }).user?.id, "course.teacher.assign", "Course", courseId, {
      teacherId,
      role: link.role,
    });
    res.status(201).json(link);
  } catch (error: any) {
    console.error("assignCourseTeacher:", error);
    res.status(500).json({ message: "Failed to assign teacher", ...(isDev && { error: error.message }) });
  }
};

// DELETE /api/admin/courses/:courseId/teachers/:teacherId
export const removeCourseTeacher = async (req: Request, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const teacherId = String(req.params.teacherId);
    await prisma.courseTeacher.delete({
      where: { courseId_teacherId: { courseId, teacherId } },
    });
    recordAudit((req as Request & { user?: { id?: string } }).user?.id, "course.teacher.remove", "Course", courseId, {
      teacherId,
    });
    res.json({ ok: true });
  } catch (error: any) {
    // Prisma throws P2025 if the row doesn't exist — return 404 for clarity.
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "Assignment not found" });
    }
    console.error("removeCourseTeacher:", error);
    res.status(500).json({ message: "Failed to remove teacher", ...(isDev && { error: error.message }) });
  }
};

// GET /api/admin/courses/:courseId/teachers
export const listCourseTeachers = async (req: Request, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const teachers = await prisma.courseTeacher.findMany({
      where: { courseId },
      select: {
        id: true,
        role: true,
        assignedAt: true,
        teacher: { select: { id: true, name: true, email: true, avatar: true, role: true } },
      },
      orderBy: { assignedAt: "asc" },
    });
    res.json({ teachers });
  } catch (error: any) {
    console.error("listCourseTeachers:", error);
    res.status(500).json({ message: "Failed to list teachers", ...(isDev && { error: error.message }) });
  }
};
