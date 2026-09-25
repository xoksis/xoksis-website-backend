import bcrypt from "bcryptjs";
import prisma from "../config/prisma";

export async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "XOKSIS Admin";

  // No fallback credentials on purpose: a default email/password committed to
  // this repo is a working admin login for anyone who reads it. Refuse to seed
  // rather than create one — set ADMIN_EMAIL / ADMIN_PASSWORD instead.
  if (!email) {
    console.warn("  !  ADMIN_EMAIL not set — skipping admin seed.");
    return;
  }

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

  if (!password) {
    console.warn(
      `  !  No user ${email} and ADMIN_PASSWORD not set — cannot create an admin.`,
    );
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
