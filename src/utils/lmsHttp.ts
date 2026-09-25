import { Response } from "express";
import prisma from "../config/prisma";

const isDev = process.env.NODE_ENV !== "production";

export function fail(res: Response, status: number, message: string, error?: unknown) {
  res.status(status).json({
    message,
    ...(isDev && error instanceof Error && { error: error.message }),
  });
}

export function serverError(res: Response, scope: string, message: string, error: unknown) {
  console.error(`${scope}:`, error);
  fail(res, 500, message, error);
}

/** Required string, trimmed, bounded. Returns null when unusable. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** Optional string. Returns undefined when absent, null when present but invalid. */
export function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, max);
}

/** Only absolute http(s) URLs are accepted, so javascript:/data: payloads can
 * never be stored and later rendered as a clickable link. */
export function optionalUrl(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const trimmed = text(value, 2048);
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function optionalInt(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function optionalDate(value: unknown): Date | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function optionalBool(value: unknown): boolean | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") return null;
  return value;
}

/** Normalised answer comparison: trimmed, case-insensitive, whitespace-collapsed. */
export function answerMatches(given: unknown, expected: string | null): boolean {
  if (expected === null || given === null || given === undefined) return false;
  if (Array.isArray(given)) return false;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(String(given)) === norm(expected);
}

/** Approved + active enrollment for the given user, or a message explaining why not. */
export async function activeEnrollment(courseId: string, userId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { applicationStatus: true, accessStatus: true },
  });
  if (!enrollment || enrollment.applicationStatus !== "APPROVED") {
    return { ok: false as const, message: "You are not enrolled in this course" };
  }
  if (enrollment.accessStatus !== "active") {
    return { ok: false as const, message: "Your access to this course has been revoked" };
  }
  return { ok: true as const };
}

export function requestIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
