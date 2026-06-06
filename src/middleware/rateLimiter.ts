import type { Request, Response, NextFunction } from 'express';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const sharedStores = new Map<string, Map<string, RateLimitInfo>>();

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  /** Reuse the same counter across multiple routes (e.g. all OTP verify endpoints). */
  storeKey?: string;
  /** Custom bucket key — defaults to client IP. */
  keyGenerator?: (req: Request) => string;
}) {
  let store: Map<string, RateLimitInfo>;
  if (options.storeKey) {
    if (!sharedStores.has(options.storeKey)) {
      sharedStores.set(options.storeKey, new Map());
    }
    store = sharedStores.get(options.storeKey)!;
  } else {
    store = new Map();
  }

  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of store.entries()) {
      if (now > value.resetTime) {
        store.delete(key);
      }
    }
  }, Math.min(options.windowMs, 60_000));

  if (interval && typeof interval.unref === 'function') {
    interval.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const bucketKey = options.keyGenerator?.(req) ?? ip;
    const now = Date.now();

    let record = store.get(bucketKey);

    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + options.windowMs };
      store.set(bucketKey, record);
    }

    record.count++;

    const remaining = Math.max(0, options.max - record.count);

    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

    if (record.count >= options.max) {
      return res.status(429).json({
        message: options.message || 'Too many requests, please try again later.',
      });
    }

    next();
  };
}
