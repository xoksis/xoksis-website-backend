import prisma from "../config/prisma";

/**
 * Fan-out helper for LMS events. Fire-and-forget: notification delivery must
 * never fail the action that triggered it.
 */
export function notifyUsers(
  userIds: string[],
  title: string,
  message: string,
): void {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  prisma.notification
    .createMany({ data: unique.map((userId) => ({ userId, title, message })) })
    .catch((error) => console.error("notifyUsers:", error));
}

export function notifyUser(userId: string, title: string, message: string): void {
  notifyUsers([userId], title, message);
}

/** Every student with live access to a course — the audience for course news. */
export async function courseAudience(courseId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({
    where: { courseId, applicationStatus: "APPROVED", accessStatus: "active" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
