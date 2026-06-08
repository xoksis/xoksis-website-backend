import bcrypt from "bcryptjs";
import prisma from "../config/prisma";

export async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@xoksis.com";
  const password = process.env.ADMIN_PASSWORD || "Xoksis@Admin2025";
  const name = process.env.ADMIN_NAME || "XOKSIS Admin";

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === "ADMIN") return; // already an admin, nothing to do
    await prisma.user.update({
      where: { email },
      data: { role: "ADMIN", emailVerified: true, onboardingDone: true },
    });
    console.log(`  ✓  Existing user promoted to ADMIN: ${email}`);
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      firstName: name.split(" ")[0] || "XOKSIS",
      lastName: name.split(" ").slice(1).join(" ") || "Admin",
      role: "ADMIN",
      emailVerified: true,
      onboardingDone: true,
      authProvider: "manual",
    },
  });
  console.log(`  ✓  Admin created: ${email}`);
}
