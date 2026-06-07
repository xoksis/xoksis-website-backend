import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/authRoutes";
import courseRoutes from "./routes/courseRoutes";
import productRoutes from "./routes/productRoutes";
import blogRoutes from "./routes/blogRoutes";
import serviceRoutes from "./routes/serviceRoutes";
import userRoutes from "./routes/userRoutes";
import adminRoutes from "./routes/adminRoutes";
import contentRoutes from "./routes/contentRoutes";
import teamRoutes from "./routes/teamRoutes";
import extraRoutes from "./routes/extraRoutes";
import enrollmentRoutes from "./routes/enrollmentRoutes";

// dotenv is loaded by index.ts BEFORE any imports — do NOT call it again here.

// ── Startup env validation ───────────────────────────────────────────────────
const REQUIRED_ENV = ["JWT_SECRET", "DATABASE_URL"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[FATAL] Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (!process.env.RESEND_API_KEY) {
  console.warn("[WARN] RESEND_API_KEY is not set — email sending will fail.");
}
if (process.env.NODE_ENV === "production" && !process.env.OTP_PEPPER) {
  console.warn("[WARN] OTP_PEPPER is not set — falling back to JWT_SECRET for OTP hashing. Set a dedicated OTP_PEPPER in production.");
}

const app = express();

// Trust the first proxy hop so req.ip is the real client IP (not the load balancer).
// Required for rate limiter IP detection to work correctly behind Nginx/Railway/Heroku.
app.set("trust proxy", 1);

// ── Security middleware ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://xoksis.com",
  "https://www.xoksis.com",
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "50kb" }));

// ── Public cache middleware ──────────────────────────────────────────────────
// Adds Cache-Control headers to GET responses on public read-only routes.
// Browsers & CDNs cache for 60s; serve stale for up to 5 min while revalidating.
// Only applies to GET — mutations (POST/PUT/DELETE) are unaffected.
function publicCache(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.method === "GET") {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  }
  next();
}

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/courses",  publicCache, courseRoutes);
app.use("/api/products", publicCache, productRoutes);
app.use("/api/blogs",    publicCache, blogRoutes);
app.use("/api/services", publicCache, serviceRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/content", publicCache, contentRoutes);
app.use("/api/team",    publicCache, teamRoutes);
app.use("/api/extra",   publicCache, extraRoutes);
app.use("/api/enrollments", enrollmentRoutes);

// Basic Route
app.get("/", (req, res) => {
  res.json({ message: "XOKSIS API is running..." });
});

// Error handling middleware — hides internals in production
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error(err.stack);

    // Handle Multer upload errors cleanly
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: "File is too large. Maximum allowed size is 5MB.",
      });
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        message: "Unexpected file upload field or too many files uploaded.",
      });
    }

    if (err.message && err.message.includes("Invalid file type")) {
      return res.status(400).json({
        message: err.message,
      });
    }

    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({
      message: "Internal Server Error",
      ...(isDev && { error: err.message }),
    });
  },
);

export default app;
