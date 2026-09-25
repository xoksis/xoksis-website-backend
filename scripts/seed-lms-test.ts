// Dev-only seed for exercising the teacher/LMS UI locally.
// Course creation via the API needs Cloudinary, so this creates fixtures directly.
// Idempotent — safe to re-run.
//
//   npx tsx scripts/seed-lms-test.ts
//
// Creates:
//   course  : lms-test-course-1  (LMS Verification Course)
//   teacher : lms-teacher@test.local  (MENTOR, LEAD on the course)
//   student : lms-student@test.local  (USER, enrolled + partial fee)
// Password for both accounts: TestPass123!

import bcrypt from "bcryptjs";
import prisma from "../src/config/prisma";

const PW = "TestPass123!";

async function main() {
  const password = await bcrypt.hash(PW, 10);

  const course = await prisma.course.upsert({
    where: { id: "lms-test-course-1" },
    update: {},
    create: {
      id: "lms-test-course-1",
      title: "LMS Verification Course",
      desc: "Sample course for exercising the teacher workspace locally.",
      tag: "Test",
      cat: "development",
      level: "Beginner",
      price: "0",
      image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80",
    },
  });

  const teacher = await prisma.user.upsert({
    where: { id: "lms-test-teacher" },
    update: { role: "MENTOR" },
    create: {
      id: "lms-test-teacher",
      email: "lms-teacher@test.local",
      password,
      name: "Test Teacher",
      role: "MENTOR",
      emailVerified: true,
      onboardingDone: true,
    },
  });

  const student = await prisma.user.upsert({
    where: { id: "lms-test-student" },
    update: {},
    create: {
      id: "lms-test-student",
      email: "lms-student@test.local",
      password,
      name: "Test Student",
      role: "USER",
      emailVerified: true,
      onboardingDone: true,
    },
  });

  await prisma.courseTeacher.upsert({
    where: { courseId_teacherId: { courseId: course.id, teacherId: teacher.id } },
    update: {},
    create: { courseId: course.id, teacherId: teacher.id, role: "LEAD" },
  });

  await prisma.enrollment.upsert({
    where: { userId_courseId: { userId: student.id, courseId: course.id } },
    update: {},
    create: {
      userId: student.id,
      courseId: course.id,
      fullName: "Test Student",
      email: student.email,
      applicationStatus: "APPROVED",
      accessStatus: "active",
      feeTier: "standard",
      fee: 2000,
      feeStatus: "partial",
    },
  });

  console.log("Seeded:");
  console.log(`  Teacher : ${teacher.email} / ${PW}   → /teacher`);
  console.log(`  Student : ${student.email} / ${PW}   → /dashboard`);
  console.log(`  Course  : ${course.title} (${course.id})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
