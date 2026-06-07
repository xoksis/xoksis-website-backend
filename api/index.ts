import app from "../src/app";
import prisma from "../src/config/prisma";

// Runs on cold start — visible in Vercel function logs
prisma.$queryRaw`SELECT 1`
  .then(() => console.log("[DB] Connected to database successfully"))
  .catch((err: Error) => console.error("[DB] Connection FAILED:", err.message));

export default app as any;
