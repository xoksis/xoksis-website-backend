// Runs pending SQL migrations via Supabase Management API on cold start.
// This bypasses port 5432/6543 restrictions entirely — uses HTTPS only.

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS "_migrations" (
        "name" TEXT PRIMARY KEY,
        "ran_at" TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TYPE IF NOT EXISTS "Role" AS ENUM ('USER', 'ADMIN', 'MENTOR');

      CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT NOT NULL,"email" TEXT NOT NULL,"password" TEXT NOT NULL,"name" TEXT,
        "firstName" TEXT,"lastName" TEXT,"country" TEXT,"dob" TEXT,
        "role" "Role" NOT NULL DEFAULT 'USER',"onboardingDone" BOOLEAN NOT NULL DEFAULT false,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,"authProvider" TEXT NOT NULL DEFAULT 'manual',
        "interests" TEXT[],"skillLevel" TEXT,"goal" TEXT,"userType" TEXT,"avatar" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        "referralCode" TEXT,"tokenVersion" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "User_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
      CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

      CREATE TABLE IF NOT EXISTS "Course" (
        "id" TEXT NOT NULL,"title" TEXT NOT NULL,"desc" TEXT NOT NULL,"tag" TEXT NOT NULL,
        "cat" TEXT NOT NULL,"level" TEXT NOT NULL,"price" TEXT NOT NULL,"hours" TEXT,"startDate" TEXT,
        "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,"reviews" INTEGER NOT NULL DEFAULT 0,
        "image" TEXT NOT NULL,"badge" TEXT,"intro" TEXT DEFAULT '',"originalPrice" TEXT DEFAULT '',
        "instructorName" TEXT DEFAULT 'XOKSIS Mentor Team',"instructorRole" TEXT DEFAULT 'Industry Instructor',
        "instructorBio" TEXT DEFAULT 'Focused on practical, project-oriented learning outcomes.',
        "instructorAvatar" TEXT DEFAULT 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
        "prerequisites" TEXT[],"curriculum" JSONB,"feedback" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "Enrollment" (
        "id" TEXT NOT NULL,"userId" TEXT NOT NULL,"courseId" TEXT NOT NULL,"fullName" TEXT,
        "email" TEXT,"contactNumber" TEXT,"gender" TEXT,"genderOther" TEXT,
        "isHafizQuran" BOOLEAN NOT NULL DEFAULT false,"isOrphan" BOOLEAN NOT NULL DEFAULT false,
        "disability" TEXT,"referralDetails" TEXT,"referralCodeUsed" TEXT,"referrerId" TEXT,
        "applicationStatus" TEXT NOT NULL DEFAULT 'APPROVED',"accessStatus" TEXT NOT NULL DEFAULT 'active',
        "courseCompleted" BOOLEAN NOT NULL DEFAULT false,"feeTier" TEXT NOT NULL DEFAULT 'free',
        "fee" INTEGER NOT NULL DEFAULT 2500,"feeStatus" TEXT NOT NULL DEFAULT 'unpaid',"feeNotes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "Enrollment_userId_idx" ON "Enrollment"("userId");
      CREATE INDEX IF NOT EXISTS "Enrollment_referrerId_idx" ON "Enrollment"("referrerId");
      CREATE UNIQUE INDEX IF NOT EXISTS "Enrollment_userId_courseId_key" ON "Enrollment"("userId", "courseId");

      CREATE TABLE IF NOT EXISTS "EmailTemplate" (
        "id" TEXT NOT NULL,"key" TEXT NOT NULL,"name" TEXT NOT NULL,"category" TEXT NOT NULL DEFAULT 'general',
        "subject" TEXT NOT NULL,"body" TEXT NOT NULL,"isDefault" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "EmailTemplate_key_key" ON "EmailTemplate"("key");

      CREATE TABLE IF NOT EXISTS "EmailCampaign" (
        "id" TEXT NOT NULL,"subject" TEXT NOT NULL,"body" TEXT NOT NULL,"targetType" TEXT NOT NULL,
        "targetFilters" JSONB,"totalCount" INTEGER NOT NULL DEFAULT 0,"sentCount" INTEGER NOT NULL DEFAULT 0,
        "failedCount" INTEGER NOT NULL DEFAULT 0,"skippedCount" INTEGER NOT NULL DEFAULT 0,
        "createdById" TEXT,"createdByEmail" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "EmailCampaignRecipient" (
        "id" TEXT NOT NULL,"campaignId" TEXT NOT NULL,"enrollmentId" TEXT,"email" TEXT NOT NULL,
        "fullName" TEXT,"status" TEXT NOT NULL DEFAULT 'pending',"error" TEXT,"resendId" TEXT,
        "renderedSubject" TEXT NOT NULL,"renderedBody" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "EmailCampaignRecipient_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "EmailCampaignRecipient_campaignId_idx" ON "EmailCampaignRecipient"("campaignId");
      CREATE INDEX IF NOT EXISTS "EmailCampaignRecipient_status_idx" ON "EmailCampaignRecipient"("status");
      CREATE INDEX IF NOT EXISTS "EmailCampaignRecipient_email_idx" ON "EmailCampaignRecipient"("email");

      CREATE TABLE IF NOT EXISTS "OtpRecord" (
        "id" TEXT NOT NULL,"email" TEXT NOT NULL,"otpHash" TEXT NOT NULL,"type" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,"used" BOOLEAN NOT NULL DEFAULT false,"attempts" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OtpRecord_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "OtpRecord_email_type_idx" ON "OtpRecord"("email", "type");

      CREATE TABLE IF NOT EXISTS "Product" (
        "id" TEXT NOT NULL,"slug" TEXT NOT NULL,"type" TEXT NOT NULL,"name" TEXT NOT NULL,
        "shortDescription" TEXT NOT NULL,"fullDescription" TEXT NOT NULL,"coverImage" TEXT NOT NULL,
        "platform" TEXT NOT NULL,"version" TEXT NOT NULL,"downloadLabel" TEXT NOT NULL,
        "features" TEXT[],"screenshots" TEXT[],
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "Product_slug_key" ON "Product"("slug");

      CREATE TABLE IF NOT EXISTS "BlogPost" (
        "id" TEXT NOT NULL,"slug" TEXT NOT NULL,"category" TEXT NOT NULL,"title" TEXT NOT NULL,
        "excerpt" TEXT NOT NULL,"coverImage" TEXT NOT NULL,"readTime" TEXT NOT NULL,
        "publishedAt" TEXT NOT NULL,"authorId" TEXT NOT NULL,"sections" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "BlogPost_slug_key" ON "BlogPost"("slug");
      CREATE INDEX IF NOT EXISTS "BlogPost_authorId_idx" ON "BlogPost"("authorId");

      CREATE TABLE IF NOT EXISTS "Service" (
        "id" TEXT NOT NULL,"slug" TEXT NOT NULL,"title" TEXT NOT NULL,"shortTitle" TEXT NOT NULL,
        "shortDescription" TEXT NOT NULL,"longDescription" TEXT NOT NULL,"image" TEXT NOT NULL,
        "accent" TEXT NOT NULL,"icon" TEXT NOT NULL,"highlights" TEXT[],"process" TEXT[],
        "technologies" TEXT[],"team" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "Service_slug_key" ON "Service"("slug");

      CREATE TABLE IF NOT EXISTS "Subscription" (
        "id" TEXT NOT NULL,"userId" TEXT NOT NULL,"plan" TEXT NOT NULL,"status" TEXT NOT NULL,
        "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"endDate" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "Subscription_userId_idx" ON "Subscription"("userId");

      CREATE TABLE IF NOT EXISTS "Certificate" (
        "id" TEXT NOT NULL,"userId" TEXT NOT NULL,"title" TEXT NOT NULL,
        "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"url" TEXT NOT NULL,
        CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "Certificate_userId_idx" ON "Certificate"("userId");

      CREATE TABLE IF NOT EXISTS "Notification" (
        "id" TEXT NOT NULL,"userId" TEXT NOT NULL,"title" TEXT NOT NULL,"message" TEXT NOT NULL,
        "read" BOOLEAN NOT NULL DEFAULT false,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");

      CREATE TABLE IF NOT EXISTS "Feedback" (
        "id" TEXT NOT NULL,"userId" TEXT NOT NULL,"content" TEXT NOT NULL,"rating" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "Feedback_userId_idx" ON "Feedback"("userId");

      CREATE TABLE IF NOT EXISTS "SiteContent" (
        "id" TEXT NOT NULL,"key" TEXT NOT NULL,"content" JSONB NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "SiteContent_key_key" ON "SiteContent"("key");

      CREATE TABLE IF NOT EXISTS "TeamMember" (
        "id" TEXT NOT NULL,"name" TEXT NOT NULL,"role" TEXT NOT NULL,"image" TEXT NOT NULL,
        "order" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "FAQ" (
        "id" TEXT NOT NULL,"question" TEXT NOT NULL,"answer" TEXT NOT NULL,"order" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "FAQ_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "JourneyStep" (
        "id" TEXT NOT NULL,"number" TEXT NOT NULL,"title" TEXT NOT NULL,"subtitle" TEXT NOT NULL,
        "description" TEXT NOT NULL,"order" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "JourneyStep_pkey" PRIMARY KEY ("id")
      );

      ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey"
        FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_referrerId_fkey"
        FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "EmailCampaignRecipient" ADD CONSTRAINT "EmailCampaignRecipient_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_authorId_fkey"
        FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        NOT VALID;
      ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        NOT VALID;
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn("[MIGRATE] Skipping — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.");
    return;
  }

  for (const migration of MIGRATIONS) {
    try {
      // Check if already ran
      const checkRes = await fetch(`${supabaseUrl}/rest/v1/_migrations?name=eq.${migration.name}&select=name`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });

      if (checkRes.ok) {
        const rows = await checkRes.json();
        if (Array.isArray(rows) && rows.length > 0) {
          console.log(`[MIGRATE] ${migration.name} already applied, skipping.`);
          continue;
        }
      }

      // Run the migration via Supabase SQL endpoint
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ sql: migration.sql }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[MIGRATE] ${migration.name} FAILED:`, err);
        continue;
      }

      // Record migration
      await fetch(`${supabaseUrl}/rest/v1/_migrations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ name: migration.name }),
      });

      console.log(`[MIGRATE] ${migration.name} applied successfully.`);
    } catch (err) {
      console.error(`[MIGRATE] ${migration.name} error:`, err);
    }
  }
}
