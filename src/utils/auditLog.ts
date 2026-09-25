import prisma from "../config/prisma";

export type AuditAction =
  | "user.role.change"
  | "course.teacher.assign"
  | "course.teacher.remove"
  | "enrollment.bulkAssign"
  | "enrollment.fee.update"
  | "enrollment.fee.bulkUpdate"
  | "enrollment.access.update"
  | "announcement.platform.create"
  | "announcement.platform.update"
  | "announcement.platform.delete"
  | "lms.settings.update"
  | "certificate.issue"
  | "submission.grade"
  | "quizAttempt.grade";

/**
 * Fire-and-forget append to the audit trail. Never throws: a failed audit write
 * must not fail the operation the user actually asked for.
 */
export function recordAudit(
  actorId: string | undefined,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  meta?: Record<string, unknown>,
) {
  prisma.auditLog
    .create({
      data: {
        actorId: actorId ?? null,
        action,
        entityType,
        entityId,
        meta: meta ? (meta as object) : undefined,
      },
    })
    .catch((error) => console.error("recordAudit:", error));
}
