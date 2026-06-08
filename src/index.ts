import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import prisma from "./config/prisma";
import { seedAdmin } from "./utils/seedAdmin";

const PORT = process.env.PORT || 5001;
const NODE_ENV = process.env.NODE_ENV || "development";

async function start() {
  let dbStatus = "Connected";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = "FAILED — " + (err instanceof Error ? err.message : String(err));
  }

  try {
    await seedAdmin();
  } catch (err) {
    console.error("  ✗  seedAdmin failed:", err instanceof Error ? err.message : err);
  }

  app.listen(PORT, () => {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  XOKSIS API Server`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Status   : Running`);
    console.log(`  URL      : http://localhost:${PORT}`);
    console.log(`  Env      : ${NODE_ENV}`);
    console.log(`  Database : ${dbStatus}`);
    console.log(`  Started  : ${new Date().toLocaleString()}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Routes registered:`);
    console.log(`    /api/auth       Authentication`);
    console.log(`    /api/users      User profile & onboarding`);
    console.log(`    /api/courses    Courses`);
    console.log(`    /api/products   Products`);
    console.log(`    /api/blogs      Blog posts`);
    console.log(`    /api/services   Services`);
    console.log(`    /api/team       Team members`);
    console.log(`    /api/content    CMS content`);
    console.log(`    /api/extra      FAQ & Journey steps`);
    console.log(`    /api/admin      Admin dashboard`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });
}

start();
