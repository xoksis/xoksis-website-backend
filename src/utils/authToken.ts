import type { CookieOptions, Request, Response } from "express";
import jwt from "jsonwebtoken";

export const AUTH_COOKIE = "xoksis_token";
const JWT_EXPIRY = "30d";
const JWT_ALGORITHMS: jwt.Algorithm[] = ["HS256"];

export interface TokenPayload {
  id: string;
  tokenVersion: number;
}

function getCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  const sameSiteEnv = process.env.COOKIE_SAME_SITE;
  const sameSite =
    sameSiteEnv === "none" || sameSiteEnv === "lax" || sameSiteEnv === "strict"
      ? sameSiteEnv
      : isProd
        ? "strict"
        : "lax";

  return {
    httpOnly: true,
    secure: isProd || sameSite === "none",
    sameSite,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

export function signAuthToken(userId: string, tokenVersion: number): string {
  return jwt.sign(
    { id: userId, tokenVersion },
    process.env.JWT_SECRET!,
    { expiresIn: JWT_EXPIRY, algorithm: "HS256" },
  );
}

export function setAuthCookie(res: Response, userId: string, tokenVersion: number): void {
  res.cookie(AUTH_COOKIE, signAuthToken(userId, tokenVersion), getCookieOptions());
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, getCookieOptions());
}

export function extractAuthToken(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE];
  if (typeof cookieToken === "string" && cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const bearer = authHeader.split(" ")[1];
    return bearer || null;
  }
  return null;
}

export function verifyAuthToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: JWT_ALGORITHMS,
    }) as TokenPayload;
    if (!decoded?.id || typeof decoded.tokenVersion !== "number") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function authUserResponse(user: {
  id: string;
  name: string | null;
  email: string;
  role: string;
  onboardingDone: boolean;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    onboardingDone: user.onboardingDone,
  };
}
