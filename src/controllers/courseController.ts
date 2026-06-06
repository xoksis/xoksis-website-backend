import type { Request, Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { getInitialEnrollmentStatus, isAutoApproveEnrollments } from "../config/enrollmentConfig";
import { resolveImageField, validateOptionalImageUrl } from "../utils/imageUrl";

const isDev = process.env.NODE_ENV !== "production";

function safeParseJson(value: any, fieldName: string): { ok: true; data: any } | { ok: false; error: string } {
  if (Array.isArray(value)) return { ok: true, data: value };
  if (value === undefined || value === null) return { ok: true, data: [] };
  if (typeof value === "string") {
    try {
      return { ok: true, data: JSON.parse(value) };
    } catch {
      return { ok: false, error: `${fieldName} must be valid JSON.` };
    }
  }
  if (typeof value === "object") return { ok: true, data: value };
  return { ok: false, error: `${fieldName} must be a JSON array or string.` };
}

// GET /api/courses?page=1&limit=20
export const getCourses = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const skip  = (page - 1) * limit;

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        skip,
        take: limit,
        select: {
          id: true, title: true, desc: true, tag: true, cat: true,
          level: true, price: true, originalPrice: true, hours: true,
          startDate: true,
          image: true, badge: true, intro: true,
          instructorName: true, instructorRole: true, instructorAvatar: true,
          prerequisites: true, createdAt: true,
        },
      }),
      prisma.course.count(),
    ]);

    res.json({ data: courses, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    console.error("getCourses:", error);
    res.status(500).json({ message: "Failed to retrieve courses", ...(isDev && { error: error.message }) });
  }
};

// GET /api/courses/:id
export const getCourseById = async (req: Request, res: Response) => {
  try {
    const course = await prisma.course.findUnique({ where: { id: String(req.params.id) } });
    if (!course) return res.status(404).json({ message: "Course not found" });
    res.json(course);
  } catch (error: any) {
    console.error("getCourseById:", error);
    res.status(500).json({ message: "Failed to retrieve course", ...(isDev && { error: error.message }) });
  }
};

// POST /api/courses — admin only
export const createCourse = async (req: Request, res: Response) => {
  try {
    const {
      title, desc, tag, cat, level, price, hours, badge, intro, originalPrice,
      startDate,
      instructorName, instructorRole, instructorBio, instructorAvatar,
      prerequisites, curriculum, feedback,
    } = req.body;

    // Required field validation
    if (!title || !price) {
      return res.status(400).json({ message: "title and price are required." });
    }

    const uploadedImage = req.file ? (req.file as any).path : undefined;
    const imageResult = resolveImageField(uploadedImage, req.body.image, "Course image", { required: true });
    if (!imageResult.ok) return res.status(400).json({ message: imageResult.error });

    const avatarResult = validateOptionalImageUrl(instructorAvatar, "Instructor avatar");
    if (!avatarResult.ok) return res.status(400).json({ message: avatarResult.error });
    const safeInstructorAvatar = avatarResult.url ?? instructorAvatar;

    // Safe JSON parsing
    const prereqParsed = safeParseJson(prerequisites, "prerequisites");
    if (!prereqParsed.ok) return res.status(400).json({ message: prereqParsed.error });

    const curriculumParsed = safeParseJson(curriculum, "curriculum");
    if (!curriculumParsed.ok) return res.status(400).json({ message: curriculumParsed.error });

    const feedbackParsed = safeParseJson(feedback, "feedback");
    if (!feedbackParsed.ok) return res.status(400).json({ message: feedbackParsed.error });

    const course = await prisma.course.create({
      data: {
        title, desc, tag, cat, level,
        price: String(price),
        hours: hours ? String(hours) : null,
        startDate: startDate ? String(startDate) : null,
        image: imageResult.url, badge, intro,
        originalPrice: originalPrice ? String(originalPrice) : "",
        instructorName, instructorRole, instructorBio, instructorAvatar: safeInstructorAvatar,
        prerequisites: prereqParsed.data,
        curriculum: curriculumParsed.data,
        feedback: feedbackParsed.data,
      },
    });

    res.status(201).json(course);
  } catch (error: any) {
    console.error("createCourse:", error);
    res.status(500).json({ message: "Failed to create course", ...(isDev && { error: error.message }) });
  }
};

// PUT /api/courses/:id — admin only
export const updateCourse = async (req: Request, res: Response) => {
  try {
    const courseId = String(req.params.id);

    const existing = await prisma.course.findUnique({ where: { id: courseId } });
    if (!existing) return res.status(404).json({ message: "Course not found." });

    const {
      title, desc, tag, cat, level, price, hours, badge, intro, originalPrice,
      startDate,
      instructorName, instructorRole, instructorBio, instructorAvatar,
      prerequisites, curriculum, feedback,
    } = req.body;

    // Preserve existing image if no new upload and no body.image sent
    let image = existing.image;
    if (req.file) {
      image = (req.file as any).path;
    } else if (req.body.image !== undefined) {
      const imageResult = validateOptionalImageUrl(req.body.image, "Course image");
      if (!imageResult.ok) return res.status(400).json({ message: imageResult.error });
      if (imageResult.url) image = imageResult.url;
    }

    let safeInstructorAvatar = instructorAvatar ?? existing.instructorAvatar;
    if (instructorAvatar !== undefined) {
      const avatarResult = validateOptionalImageUrl(instructorAvatar, "Instructor avatar");
      if (!avatarResult.ok) return res.status(400).json({ message: avatarResult.error });
      safeInstructorAvatar = avatarResult.url ?? instructorAvatar;
    }

    const prereqParsed = safeParseJson(prerequisites, "prerequisites");
    if (!prereqParsed.ok) return res.status(400).json({ message: prereqParsed.error });

    const curriculumParsed = safeParseJson(curriculum, "curriculum");
    if (!curriculumParsed.ok) return res.status(400).json({ message: curriculumParsed.error });

    const feedbackParsed = safeParseJson(feedback, "feedback");
    if (!feedbackParsed.ok) return res.status(400).json({ message: feedbackParsed.error });

    const course = await prisma.course.update({
      where: { id: courseId },
      data: {
        ...(title         !== undefined && { title }),
        ...(desc          !== undefined && { desc }),
        ...(tag           !== undefined && { tag }),
        ...(cat           !== undefined && { cat }),
        ...(level         !== undefined && { level }),
        ...(price         !== undefined && { price: String(price) }),
        ...(hours         !== undefined && { hours: hours ? String(hours) : null }),
        ...(startDate     !== undefined && { startDate: startDate ? String(startDate) : null }),
        image,
        ...(badge         !== undefined && { badge }),
        ...(intro         !== undefined && { intro }),
        ...(originalPrice !== undefined && { originalPrice: String(originalPrice) }),
        ...(instructorName   !== undefined && { instructorName }),
        ...(instructorRole   !== undefined && { instructorRole }),
        ...(instructorBio    !== undefined && { instructorBio }),
        ...(instructorAvatar !== undefined && { instructorAvatar: safeInstructorAvatar }),
        ...(prerequisites !== undefined && { prerequisites: prereqParsed.data }),
        ...(curriculum    !== undefined && { curriculum: curriculumParsed.data }),
        ...(feedback      !== undefined && { feedback: feedbackParsed.data }),
      },
    });

    res.json(course);
  } catch (error: any) {
    console.error("updateCourse:", error);
    res.status(500).json({ message: "Failed to update course", ...(isDev && { error: error.message }) });
  }
};

// DELETE /api/courses/:id — admin only
export const deleteCourse = async (req: Request, res: Response) => {
  try {
    const courseId = String(req.params.id);

    const existing = await prisma.course.findUnique({ where: { id: courseId } });
    if (!existing) return res.status(404).json({ message: "Course not found." });

    // Warn if active enrollments exist
    const activeCount = await prisma.enrollment.count({
      where: { courseId, accessStatus: "active" },
    });
    if (activeCount > 0) {
      return res.status(409).json({
        message: `Cannot delete: ${activeCount} student(s) are actively enrolled in this course.`,
      });
    }

    await prisma.course.delete({ where: { id: courseId } });
    res.json({ message: "Course removed." });
  } catch (error: any) {
    console.error("deleteCourse:", error);
    res.status(500).json({ message: "Failed to delete course", ...(isDev && { error: error.message }) });
  }
};

// POST /api/courses/:id/enroll — quick enroll when auto-approve is enabled
export const enrollCourse = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAutoApproveEnrollments()) {
      return res.status(403).json({
        message: "Please complete the enrollment form to apply for this course.",
      });
    }

    const courseId = String(req.params.id);
    const userId = req.user!.id;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const existing = await prisma.enrollment.findFirst({ where: { userId, courseId } });
    if (existing) return res.status(409).json({ message: "Already enrolled" });

    const { applicationStatus, accessStatus } = getInitialEnrollmentStatus();

    const enrollment = await prisma.enrollment.create({
      data: {
        userId,
        courseId,
        applicationStatus,
        accessStatus,
        feeTier: "free",
        fee: 0,
        feeStatus: "unpaid",
      },
      include: { course: { select: { id: true, title: true } } },
    });

    res.status(201).json(enrollment);
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Already enrolled" });
    }
    console.error("enrollCourse:", error);
    res.status(500).json({ message: "Enrollment failed", ...(isDev && { error: error.message }) });
  }
};

// DELETE /api/courses/:id/enroll
export const unenrollCourse = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.id);
    const userId   = req.user!.id;

    const result = await prisma.enrollment.deleteMany({ where: { userId, courseId } });
    if (result.count === 0) {
      return res.status(404).json({ message: "No enrollment found to remove." });
    }
    res.json({ message: "Unenrolled successfully." });
  } catch (error: any) {
    console.error("unenrollCourse:", error);
    res.status(500).json({ message: "Failed to unenroll", ...(isDev && { error: error.message }) });
  }
};
