// Run: ADMIN_EMAIL=... ADMIN_PASSWORD=... node create-admin.js
// Creates or upgrades a user to ADMIN role directly via Prisma.
// Credentials MUST be supplied via environment variables — never hardcoded.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_NAME || 'XOKSIS Admin';

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.');
    console.error('   Example: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD="your-secure-password" node create-admin.js');
    process.exit(1);
  }

  if (ADMIN_PASSWORD.length < 12) {
    console.error('❌ ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

  if (existing) {
    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const updated = await prisma.user.update({
      where: { email: ADMIN_EMAIL },
      data: {
        role: 'ADMIN',
        emailVerified: true,
        onboardingDone: true,
        password: hashed,
        tokenVersion: { increment: 1 },
      },
    });
    console.log(`✅ Existing user upgraded to ADMIN: ${updated.email}`);
    console.log('   Password updated and all existing sessions invalidated.');
    return;
  }

  const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      password: hashed,
      name: ADMIN_NAME,
      firstName: ADMIN_NAME.split(' ')[0] || 'XOKSIS',
      lastName: ADMIN_NAME.split(' ').slice(1).join(' ') || 'Admin',
      role: 'ADMIN',
      emailVerified: true,
      onboardingDone: true,
      authProvider: 'manual',
    },
  });

  console.log('✅ Admin created successfully');
  console.log(`   Email: ${admin.email}`);
  console.log('   Role : ADMIN');
  console.log('   (Password was taken from ADMIN_PASSWORD env var — not printed)');
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
