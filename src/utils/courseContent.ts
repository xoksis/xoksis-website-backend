import prisma from "../config/prisma";

/**
 * Loads the full learning content of a course: ordered modules with their
 * lessons, plus the course-wide materials and announcements feeds.
 *
 * Shared by the teacher workspace and the student course view so both sides
 * always agree on ordering.
 */
export async function buildCourseContentTree(courseId: string) {
  const [modules, materials, announcements] = await Promise.all([
    prisma.module.findMany({
      where: { courseId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: {
        lessons: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      },
    }),
    prisma.material.findMany({
      where: { courseId },
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.announcement.findMany({
      where: { courseId },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const lessonCount = modules.reduce((sum, m) => sum + m.lessons.length, 0);
  const totalMinutes = modules.reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + (l.durationMinutes || 0), 0),
    0,
  );

  return {
    modules,
    materials,
    announcements,
    stats: { moduleCount: modules.length, lessonCount, totalMinutes },
  };
}
