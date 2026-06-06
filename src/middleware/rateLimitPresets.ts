import type { Request } from "express";
import { createRateLimiter } from "./rateLimiter";

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function emailFromBody(req: Request): string {
  const email = req.body?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again after 15 minutes.",
});

export const registerLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many registration attempts. Please try again after 15 minutes.",
});

/** Per IP + email — limits OTP email spam across forgot-password and resend-otp. */
export const otpRequestLimiter = createRateLimiter({
  storeKey: "otp-request",
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Too many OTP requests. Please try again after 15 minutes.",
  keyGenerator: (req) => {
    const email = emailFromBody(req);
    return email ? `${clientIp(req)}:${email}` : clientIp(req);
  },
});

/** Single verify budget per IP + email across verify-otp, reset-password, set-password. */
export const otpVerifyLimiter = createRateLimiter({
  storeKey: "otp-verify",
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Too many OTP verification attempts. Please try again after 15 minutes.",
  keyGenerator: (req) => {
    const email = emailFromBody(req);
    return email ? `${clientIp(req)}:${email}` : clientIp(req);
  },
});

export const enrollmentSubmitLimiter = createRateLimiter({
  storeKey: "enrollment-submit",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many enrollment attempts. Please try again later.",
});

export const uploadLimiter = createRateLimiter({
  storeKey: "upload",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many upload requests. Please try again later.",
});

export const passwordChangeLimiter = createRateLimiter({
  storeKey: "password-change",
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password change attempts. Please try again after 15 minutes.",
  keyGenerator: (req) => {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    return userId ? `user:${userId}` : clientIp(req);
  },
});
