import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { buildCourseContentTree } from "../utils/courseContent";
import { courseAudience, notifyUsers } from "../utils/notify";

const isDev = process.env.NODE_ENV !== "production";

const LESSON_TYPES = ["VIDEO", "READING", "LINK", "FILE"];
const MATERIAL_TYPES = ["LINK", "GUIDE", "VIDEO", "PDF"];

function fail(res: Response, status: number, message: string, error?: unknown) {
  res.status(status).json({
    message,
    ...(isDev && error instanceof Error && { error: error.message }),
  });
}

/** Trimmed non-empty string within a length budget, else null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** Optional text: undefined when absent/blank, null when present but invalid. */
function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, max);
}

/**
 * Only absolute http(s) URLs are accepted. Blocks javascript:/data: payloads
 * from being stored and later rendered as clickable links.
 */
function url(value: unknown): string | null {
  const trimmed = text(value, 2048);
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function optionalUrl(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return url(value);
}

function optionalInt(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function oneOf(value: unknown, allowed: string[]): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) return null;
  return value;
}

/** Ensures a nested resource actually belongs to the course in the URL. */
async function moduleBelongsToCourse(moduleId: string, courseId: string) {
  return prisma.module.findFirst({ where: { id: moduleId, courseId }, select: { id: true } });
}

async function lessonBelongsToCourse(lessonId: string, moduleId: string, courseId: string) {
  return prisma.lesson.findFirst({
    where: { id: lessonId, moduleId, module: { courseId } },
    select: { id: true },
  });
}

// ── Read ─────────────────────────────────────────────────────────────────────

// GET /api/teacher/courses/:courseId/content
export const getCourseContent = async (req: AuthRequest, res: Response) => {
  try {
    res.json(await buildCourseContentTree(String(req.params.courseId)));
  } catch (error) {
    console.error("getCourseContent:", error);
    fail(res, 500, "Failed to load course content", error);
  }
};

// ── Modules ──────────────────────────────────────────────────────────────────

// POST /api/teacher/courses/:courseId/modules
export const createModule = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const title = text(req.body?.title, 160);
    if (!title) return fail(res, 400, "Module title is required (max 160 characters)");

    const summary = optionalText(req.body?.summary, 500);
    if (summary === null) return fail(res, 400, "Module summary is too long (max 500 characters)");

    const requestedOrder = optionalInt(req.body?.order, 0, 9999);
    if (requestedOrder === null) return fail(res, 400, "Module order must be a whole number");

    const order =
      requestedOrder ?? (await prisma.module.count({ where: { courseId } }));

    const created = await prisma.module.create({
      data: { courseId, title, summary, order },
      include: { lessons: true },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error("createModule:", error);
    fail(res, 500, "Failed to create module", error);
  }
};

// PUT /api/teacher/courses/:courseId/modules/reorder
// Declared before /modules/:moduleId so "reorder" is not read as an id.
export const reorderModules = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
      return fail(res, 400, "orderedIds must be an array of module ids");
    }

    const owned = await prisma.module.findMany({
      where: { courseId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((m) => m.id));
    if (orderedIds.length !== ownedIds.size || orderedIds.some((id) => !ownedIds.has(id))) {
      return fail(res, 400, "orderedIds must list every module in this course exactly once");
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.module.update({ where: { id: String(id) }, data: { order: index } }),
      ),
    );

    res.json(await buildCourseContentTree(courseId));
  } catch (error) {
    console.error("reorderModules:", error);
    fail(res, 500, "Failed to reorder modules", error);
  }
};

// PUT /api/teacher/courses/:courseId/modules/:moduleId
export const updateModule = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const moduleId = String(req.params.moduleId);
    if (!(await moduleBelongsToCourse(moduleId, courseId))) {
      return fail(res, 404, "Module not found in this course");
    }

    const data: { title?: string; summary?: string | null; order?: number } = {};

    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 160);
      if (!title) return fail(res, 400, "Module title cannot be empty (max 160 characters)");
      data.title = title;
    }
    if (req.body?.summary !== undefined) {
      const summary = optionalText(req.body.summary, 500);
      if (summary === null) return fail(res, 400, "Module summary is too long (max 500 characters)");
      data.summary = summary ?? null;
    }
    if (req.body?.order !== undefined) {
      const order = optionalInt(req.body.order, 0, 9999);
      if (order === null) return fail(res, 400, "Module order must be a whole number");
      data.order = order;
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const updated = await prisma.module.update({
      where: { id: moduleId },
      data,
      include: { lessons: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
    });
    res.json(updated);
  } catch (error) {
    console.error("updateModule:", error);
    fail(res, 500, "Failed to update module", error);
  }
};

// DELETE /api/teacher/courses/:courseId/modules/:moduleId
export const deleteModule = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const moduleId = String(req.params.moduleId);
    if (!(await moduleBelongsToCourse(moduleId, courseId))) {
      return fail(res, 404, "Module not found in this course");
    }
    await prisma.module.delete({ where: { id: moduleId } });
    res.json({ message: "Module deleted", id: moduleId });
  } catch (error) {
    console.error("deleteModule:", error);
    fail(res, 500, "Failed to delete module", error);
  }
};

// ── Lessons ──────────────────────────────────────────────────────────────────

// POST /api/teacher/courses/:courseId/modules/:moduleId/lessons
export const createLesson = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const moduleId = String(req.params.moduleId);
    if (!(await moduleBelongsToCourse(moduleId, courseId))) {
      return fail(res, 404, "Module not found in this course");
    }

    const title = text(req.body?.title, 200);
    if (!title) return fail(res, 400, "Lesson title is required (max 200 characters)");

    // oneOf returns null for an unrecognised value — check before defaulting.
    const requestedType = oneOf(req.body?.type, LESSON_TYPES);
    if (requestedType === null) {
      return fail(res, 400, `Lesson type must be one of: ${LESSON_TYPES.join(", ")}`);
    }
    const type = requestedType ?? "READING";

    const contentUrl = optionalUrl(req.body?.contentUrl);
    if (contentUrl === null) return fail(res, 400, "Lesson link must be a valid http(s) URL");

    const contentText = optionalText(req.body?.contentText, 20000);
    if (contentText === null) return fail(res, 400, "Lesson text is too long (max 20000 characters)");

    if (type !== "READING" && !contentUrl) {
      return fail(res, 400, `A ${type.toLowerCase()} lesson needs a link`);
    }

    const durationMinutes = optionalInt(req.body?.durationMinutes, 1, 6000);
    if (durationMinutes === null) return fail(res, 400, "Duration must be between 1 and 6000 minutes");

    const requestedOrder = optionalInt(req.body?.order, 0, 9999);
    if (requestedOrder === null) return fail(res, 400, "Lesson order must be a whole number");

    const order = requestedOrder ?? (await prisma.lesson.count({ where: { moduleId } }));

    const created = await prisma.lesson.create({
      data: { moduleId, title, type, contentUrl, contentText, durationMinutes, order },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error("createLesson:", error);
    fail(res, 500, "Failed to create lesson", error);
  }
};

// PUT /api/teacher/courses/:courseId/modules/:moduleId/lessons/:lessonId
export const updateLesson = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const moduleId = String(req.params.moduleId);
    const lessonId = String(req.params.lessonId);
    if (!(await lessonBelongsToCourse(lessonId, moduleId, courseId))) {
      return fail(res, 404, "Lesson not found in this module");
    }

    const existing = await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } });
    const data: {
      title?: string;
      type?: string;
      contentUrl?: string | null;
      contentText?: string | null;
      durationMinutes?: number | null;
      order?: number;
    } = {};

    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 200);
      if (!title) return fail(res, 400, "Lesson title cannot be empty (max 200 characters)");
      data.title = title;
    }
    if (req.body?.type !== undefined) {
      const type = oneOf(req.body.type, LESSON_TYPES);
      if (!type) return fail(res, 400, `Lesson type must be one of: ${LESSON_TYPES.join(", ")}`);
      data.type = type;
    }
    if (req.body?.contentUrl !== undefined) {
      const contentUrl = optionalUrl(req.body.contentUrl);
      if (contentUrl === null) return fail(res, 400, "Lesson link must be a valid http(s) URL");
      data.contentUrl = contentUrl ?? null;
    }
    if (req.body?.contentText !== undefined) {
      const contentText = optionalText(req.body.contentText, 20000);
      if (contentText === null) return fail(res, 400, "Lesson text is too long (max 20000 characters)");
      data.contentText = contentText ?? null;
    }
    if (req.body?.durationMinutes !== undefined) {
      const durationMinutes = optionalInt(req.body.durationMinutes, 1, 6000);
      if (durationMinutes === null) return fail(res, 400, "Duration must be between 1 and 6000 minutes");
      data.durationMinutes = durationMinutes ?? null;
    }
    if (req.body?.order !== undefined) {
      const order = optionalInt(req.body.order, 0, 9999);
      if (order === null) return fail(res, 400, "Lesson order must be a whole number");
      data.order = order;
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    // A non-reading lesson must keep a link after the merge.
    const nextType = data.type ?? existing.type;
    const nextUrl = data.contentUrl !== undefined ? data.contentUrl : existing.contentUrl;
    if (nextType !== "READING" && !nextUrl) {
      return fail(res, 400, `A ${nextType.toLowerCase()} lesson needs a link`);
    }

    const updated = await prisma.lesson.update({ where: { id: lessonId }, data });
    res.json(updated);
  } catch (error) {
    console.error("updateLesson:", error);
    fail(res, 500, "Failed to update lesson", error);
  }
};

// DELETE /api/teacher/courses/:courseId/modules/:moduleId/lessons/:lessonId
export const deleteLesson = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const moduleId = String(req.params.moduleId);
    const lessonId = String(req.params.lessonId);
    if (!(await lessonBelongsToCourse(lessonId, moduleId, courseId))) {
      return fail(res, 404, "Lesson not found in this module");
    }
    await prisma.lesson.delete({ where: { id: lessonId } });
    res.json({ message: "Lesson deleted", id: lessonId });
  } catch (error) {
    console.error("deleteLesson:", error);
    fail(res, 500, "Failed to delete lesson", error);
  }
};

// ── Materials ────────────────────────────────────────────────────────────────

// POST /api/teacher/courses/:courseId/materials
export const createMaterial = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const title = text(req.body?.title, 200);
    if (!title) return fail(res, 400, "Material title is required (max 200 characters)");

    const link = url(req.body?.url);
    if (!link) return fail(res, 400, "Material link must be a valid http(s) URL");

    const requestedType = oneOf(req.body?.type, MATERIAL_TYPES);
    if (requestedType === null) {
      return fail(res, 400, `Material type must be one of: ${MATERIAL_TYPES.join(", ")}`);
    }
    const type = requestedType ?? "LINK";

    const description = optionalText(req.body?.description, 1000);
    if (description === null) return fail(res, 400, "Description is too long (max 1000 characters)");

    const created = await prisma.material.create({
      data: { courseId, title, url: link, type, description, uploadedById: req.user!.id },
      include: { uploadedBy: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error("createMaterial:", error);
    fail(res, 500, "Failed to add material", error);
  }
};

// PUT /api/teacher/courses/:courseId/materials/:materialId
export const updateMaterial = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const materialId = String(req.params.materialId);

    const existing = await prisma.material.findFirst({
      where: { id: materialId, courseId },
      select: { id: true },
    });
    if (!existing) return fail(res, 404, "Material not found in this course");

    const data: { title?: string; url?: string; type?: string; description?: string | null } = {};

    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 200);
      if (!title) return fail(res, 400, "Material title cannot be empty (max 200 characters)");
      data.title = title;
    }
    if (req.body?.url !== undefined) {
      const link = url(req.body.url);
      if (!link) return fail(res, 400, "Material link must be a valid http(s) URL");
      data.url = link;
    }
    if (req.body?.type !== undefined) {
      const type = oneOf(req.body.type, MATERIAL_TYPES);
      if (!type) return fail(res, 400, `Material type must be one of: ${MATERIAL_TYPES.join(", ")}`);
      data.type = type;
    }
    if (req.body?.description !== undefined) {
      const description = optionalText(req.body.description, 1000);
      if (description === null) return fail(res, 400, "Description is too long (max 1000 characters)");
      data.description = description ?? null;
    }
    if (Object.keys(data).length === 0) return fail(res, 400, "Nothing to update");

    const updated = await prisma.material.update({
      where: { id: materialId },
      data,
      include: { uploadedBy: { select: { id: true, name: true, email: true } } },
    });
    res.json(updated);
  } catch (error) {
    console.error("updateMaterial:", error);
    fail(res, 500, "Failed to update material", error);
  }
};

// DELETE /api/teacher/courses/:courseId/materials/:materialId
export const deleteMaterial = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const materialId = String(req.params.materialId);

    const existing = await prisma.material.findFirst({
      where: { id: materialId, courseId },
      select: { id: true },
    });
    if (!existing) return fail(res, 404, "Material not found in this course");

    await prisma.material.delete({ where: { id: materialId } });
    res.json({ message: "Material deleted", id: materialId });
  } catch (error) {
    console.error("deleteMaterial:", error);
    fail(res, 500, "Failed to delete material", error);
  }
};

// ── Announcements ────────────────────────────────────────────────────────────

// POST /api/teacher/courses/:courseId/announcements
export const createAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const title = text(req.body?.title, 200);
    if (!title) return fail(res, 400, "Announcement title is required (max 200 characters)");

    const body = text(req.body?.body, 5000);
    if (!body) return fail(res, 400, "Announcement body is required (max 5000 characters)");

    const created = await prisma.announcement.create({
      data: {
        courseId,
        authorId: req.user!.id,
        title,
        body,
        pinned: req.body?.pinned === true,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    const audience = await courseAudience(courseId);
    notifyUsers(audience, `Announcement: ${title}`, body.slice(0, 500));

    res.status(201).json(created);
  } catch (error) {
    console.error("createAnnouncement:", error);
    fail(res, 500, "Failed to post announcement", error);
  }
};

// PUT /api/teacher/courses/:courseId/announcements/:announcementId
export const updateAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const announcementId = String(req.params.announcementId);

    const existing = await prisma.announcement.findFirst({
      where: { id: announcementId, courseId },
      select: { id: true },
    });
    if (!existing) return fail(res, 404, "Announcement not found in this course");

    const data: { title?: string; body?: string; pinned?: boolean } = {};

    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 200);
      if (!title) return fail(res, 400, "Announcement title cannot be empty (max 200 characters)");
      data.title = title;
    }
    if (req.body?.body !== undefined) {
      const body = text(req.body.body, 5000);
      if (!body) return fail(res, 400, "Announcement body cannot be empty (max 5000 characters)");
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
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    res.json(updated);
  } catch (error) {
    console.error("updateAnnouncement:", error);
    fail(res, 500, "Failed to update announcement", error);
  }
};

// DELETE /api/teacher/courses/:courseId/announcements/:announcementId
export const deleteAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const announcementId = String(req.params.announcementId);

    const existing = await prisma.announcement.findFirst({
      where: { id: announcementId, courseId },
      select: { id: true },
    });
    if (!existing) return fail(res, 404, "Announcement not found in this course");

    await prisma.announcement.delete({ where: { id: announcementId } });
    res.json({ message: "Announcement deleted", id: announcementId });
  } catch (error) {
    console.error("deleteAnnouncement:", error);
    fail(res, 500, "Failed to delete announcement", error);
  }
};
