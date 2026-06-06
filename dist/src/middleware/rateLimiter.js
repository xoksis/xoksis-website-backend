export function createRateLimiter(options) {
    const store = new Map();
    // Periodically clean up expired entries to prevent memory leaks
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
    return (req, res, next) => {
        // Use req.ip which respects Express's 'trust proxy' setting — NOT the
        // raw X-Forwarded-For header which is trivially spoofable by clients.
        // Set `app.set('trust proxy', 1)` in app.ts if behind a reverse proxy.
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let record = store.get(ip);
        if (!record || now > record.resetTime) {
            record = { count: 0, resetTime: now + options.windowMs };
            store.set(ip, record);
        }
        record.count++;
        const remaining = Math.max(0, options.max - record.count);
        res.setHeader('X-RateLimit-Limit', options.max);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());
        // Fixed off-by-one: block at >= max (was > max, allowing max+1 requests)
        if (record.count >= options.max) {
            return res.status(429).json({
                message: options.message || 'Too many requests, please try again later.',
            });
        }
        next();
    };
}
