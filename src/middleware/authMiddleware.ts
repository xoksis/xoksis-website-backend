import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { extractAuthToken, verifyAuthToken } from '../utils/authToken';

// ── Startup env check ────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
}

// ── User cache ───────────────────────────────────────────────────────────────
// Caches DB lookups for 60s to avoid a round-trip on every authenticated request.
// NOTE: In-process only — not shared across multiple Node worker processes.
// When role changes occur, call clearUserCache(userId) to invalidate immediately.
const USER_CACHE_TTL = 60_000;
const userCache = new Map<string, { user: any; expiresAt: number }>();

function getCachedUser(id: string) {
  const entry = userCache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { userCache.delete(id); return null; }
  return entry.user;
}

function setCachedUser(id: string, user: any) {
  userCache.set(id, { user, expiresAt: Date.now() + USER_CACHE_TTL });
}

/** Call this after any role change or account status change to force a fresh DB lookup. */
export function clearUserCache(id: string) {
  userCache.delete(id);
}

// ── protect middleware ───────────────────────────────────────────────────────
export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  const decoded = verifyAuthToken(token);
  if (!decoded) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }

  try {
    let user = getCachedUser(decoded.id);
    if (!user || user.tokenVersion !== decoded.tokenVersion) {
      user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, role: true, tokenVersion: true },
      });
      if (user) setCachedUser(decoded.id, user);
    }

    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }

    if (user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ message: 'Not authorized, session expired' });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// ── admin middleware ─────────────────────────────────────────────────────────
export const admin = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Single strict equality check — DB stores role as uppercase enum string
  if (req.user?.role === 'ADMIN') {
    return next();
  }
  res.status(403).json({ message: 'Not authorized as an admin' });
};

// ── teacher middleware ───────────────────────────────────────────────────────
// Admins pass through too so they can inspect/manage teacher-owned resources.
export const requireTeacher = (req: AuthRequest, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  if (role === 'MENTOR' || role === 'ADMIN') {
    return next();
  }
  res.status(403).json({ message: 'Not authorized as a teacher' });
};

// ── course ownership guard ───────────────────────────────────────────────────
// Verifies req.user is either an ADMIN or listed in CourseTeacher for :courseId.
// Reads course id from req.params.courseId or req.params.id.
export const teacherOwnsCourse = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const courseId = String(req.params.courseId || req.params.id || "");
  if (!userId || !courseId) {
    return res.status(400).json({ message: 'Missing user or course id' });
  }
  if (req.user?.role === 'ADMIN') {
    return next();
  }
  try {
    const row = await prisma.courseTeacher.findUnique({
      where: { courseId_teacherId: { courseId, teacherId: userId } },
      select: { id: true },
    });
    if (!row) {
      return res.status(403).json({ message: 'You do not teach this course' });
    }
    return next();
  } catch {
    return res.status(500).json({ message: 'Course ownership check failed' });
  }
};

// ── enrollment guard ─────────────────────────────────────────────────────────
// Student-side counterpart to teacherOwnsCourse: the caller must hold an
// approved, non-revoked enrollment for :courseId. Admins pass through so they
// can preview what a student sees.
export const requireEnrollment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const courseId = String(req.params.courseId || req.params.id || "");
  if (!userId || !courseId) {
    return res.status(400).json({ message: 'Missing user or course id' });
  }
  if (req.user?.role === 'ADMIN') {
    return next();
  }
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { applicationStatus: true, accessStatus: true },
    });
    if (!enrollment || enrollment.applicationStatus !== 'APPROVED') {
      return res.status(403).json({ message: 'You are not enrolled in this course' });
    }
    if (enrollment.accessStatus !== 'active') {
      return res.status(403).json({ message: 'Your access to this course has been revoked' });
    }
    return next();
  } catch {
    return res.status(500).json({ message: 'Enrollment check failed' });
  }
};
