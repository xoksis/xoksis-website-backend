import type { NextFunction, Request, Response } from "express";

/**
 * Rejects a request whose body omits any of the named fields. Without this a
 * missing field reaches Prisma as `undefined` and surfaces as a 500 rather
 * than a 400, which hides real failures in error monitoring.
 */
export const requireFields =
  (...fields: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const missing = fields.filter((field) => {
      const value = body[field];
      if (value === undefined || value === null) return true;
      return typeof value === "string" && value.trim() === "";
    });

    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      });
    }
    next();
  };
