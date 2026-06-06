import prisma from "../config/prisma";
import { sendEnrollmentCampaignEmail } from "./emailService";

type CustomRecipient = {
  fullName?: string;
  email?: string;
  contactNumber?: string;
  interestedCourse?: string;
  fee?: number | string;
  feeStatus?: string;
  accessStatus?: string;
  feeTier?: string;
  feeNotes?: string;
};

type EmailRequest = {
  targetType: string;
  filters?: Record<string, string>;
  selectedEnrollmentIds?: string[];
  customRecipients?: CustomRecipient[];
  subject: string;
  body: string;
  courseId?: string;
  classStartInDays?: string;
  classStartInHours?: string;
};

type ResolvedRecipient = {
  enrollmentId?: string;
  email: string;
  fullName: string;
  variables: Record<string, string>;
};

type SkippedRecipient = {
  enrollmentId?: string;
  email: string;
  fullName: string;
  reason: string;
};

const TEMPLATE_VARIABLES = [
  "fullName",
  "email",
  "contactNumber",
  "interestedCourse",
  "fee",
  "feeStatus",
  "accessStatus",
  "feeTier",
  "feeNotes",
  "createdAt",
  "courseStartDate",
  "classStartInDays",
  "classStartInHours",
];

const DEFAULT_TEMPLATES = [
  {
    key: "unpaid-fee-reminder",
    name: "Unpaid Fee Reminder",
    category: "fee",
    subject: "Payment reminder for {{interestedCourse}}",
    body:
      "Hi {{fullName}},\n\nYour enrollment for {{interestedCourse}} is active, but your fee status is {{feeStatus}}.\n\nAmount due: Rs. {{fee}}\nNotes: {{feeNotes}}\n\nPlease complete your payment so our team can finalize your learning access.\n\nRegards,\nXOKSIS Team",
    isDefault: true,
  },
  {
    key: "partial-payment-reminder",
    name: "Partial Payment Reminder",
    category: "fee",
    subject: "Remaining payment reminder - {{interestedCourse}}",
    body:
      "Hi {{fullName}},\n\nThank you for your partial payment for {{interestedCourse}}.\n\nCurrent fee status: {{feeStatus}}\nTotal fee: Rs. {{fee}}\nNotes: {{feeNotes}}\n\nPlease clear the remaining amount to keep your enrollment in good standing.\n\nRegards,\nXOKSIS Team",
    isDefault: true,
  },
  {
    key: "paid-confirmation",
    name: "Paid Confirmation",
    category: "fee",
    subject: "Payment confirmed for {{interestedCourse}}",
    body:
      "Hi {{fullName}},\n\nYour payment for {{interestedCourse}} has been marked as {{feeStatus}}.\n\nThank you for completing your registration with XOKSIS.\n\nRegards,\nXOKSIS Team",
    isDefault: true,
  },
  {
    key: "revoked-access-notice",
    name: "Revoked Access Notice",
    category: "access",
    subject: "Enrollment access update",
    body:
      "Hi {{fullName}},\n\nYour access status for {{interestedCourse}} is currently {{accessStatus}}.\n\nIf you believe this is a mistake, please contact the XOKSIS team with your enrollment details.\n\nRegards,\nXOKSIS Team",
    isDefault: true,
  },
  {
    key: "general-announcement",
    name: "General Announcement",
    category: "general",
    subject: "Update from XOKSIS",
    body:
      "Hi {{fullName}},\n\nWe have an update about your enrollment for {{interestedCourse}}.\n\nRegards,\nXOKSIS Team",
    isDefault: true,
  },
  {
    key: "class-start-notification",
    name: "Class Start Notification",
    category: "general",
    subject: "Class starting soon: {{interestedCourse}}",
    body:
      "Hi {{fullName}},\n\nThis is a notification that classes for {{interestedCourse}} will start on {{courseStartDate}} (in {{classStartInDays}} days and {{classStartInHours}} hours).\n\nPlease make sure you are prepared and check your portal for instructions.\n\nRegards,\nXOKSIS Team",
    isDefault: true,
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getTemplateVariables = () => TEMPLATE_VARIABLES;

// Run only once per server lifetime — not on every admin page view
let templatesInitialized = false;
export async function ensureDefaultEnrollmentEmailTemplates() {
  if (templatesInitialized) return;
  templatesInitialized = true;
  for (const template of DEFAULT_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { key: template.key },
      update: {},
      create: template,
    });
  }
}

function clean(value: unknown, fallback = "N/A") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    return clean(variables[key]);
  });
}

function enrollmentVariables(enrollment: any, input?: EmailRequest): Record<string, string> {
  const email = enrollment.email || enrollment.user?.email || "";
  const fullName = enrollment.fullName || enrollment.user?.name || email || "there";

  return {
    fullName: clean(fullName, "there"),
    email: clean(email),
    contactNumber: clean(enrollment.contactNumber),
    interestedCourse: clean(enrollment.interestedCourse || enrollment.course?.title),
    fee: clean(enrollment.fee, "0"),
    feeStatus: clean(enrollment.feeStatus),
    accessStatus: clean(enrollment.accessStatus),
    feeTier: clean(enrollment.feeTier),
    feeNotes: clean(enrollment.feeNotes),
    createdAt: enrollment.createdAt ? new Date(enrollment.createdAt).toLocaleDateString("en-US") : "N/A",
    courseStartDate: clean(enrollment.course?.startDate, "TBA"),
    classStartInDays: clean(input?.classStartInDays, "0"),
    classStartInHours: clean(input?.classStartInHours, "0"),
  };
}

function customVariables(recipient: CustomRecipient, input?: EmailRequest): Record<string, string> {
  return {
    fullName: clean(recipient.fullName, "there"),
    email: clean(recipient.email),
    contactNumber: clean(recipient.contactNumber),
    interestedCourse: clean(recipient.interestedCourse),
    fee: clean(recipient.fee, "0"),
    feeStatus: clean(recipient.feeStatus),
    accessStatus: clean(recipient.accessStatus),
    feeTier: clean(recipient.feeTier),
    feeNotes: clean(recipient.feeNotes),
    createdAt: new Date().toLocaleDateString("en-US"),
    courseStartDate: "TBA",
    classStartInDays: clean(input?.classStartInDays, "0"),
    classStartInHours: clean(input?.classStartInHours, "0"),
  };
}

function enrollmentWhere(input: EmailRequest) {
  const where: any = {};

  if (input.targetType === "selected") {
    where.id = { in: input.selectedEnrollmentIds || [] };
  } else if (["unpaid", "partial", "paid"].includes(input.targetType)) {
    where.feeStatus = input.targetType;
  } else if (input.targetType === "revoked") {
    where.accessStatus = "revoked";
  } else if (input.targetType === "currentFilters") {
    if (input.filters?.feeTier) where.feeTier = input.filters.feeTier;
    if (input.filters?.accessStatus) where.accessStatus = input.filters.accessStatus;
    if (input.filters?.feeStatus) where.feeStatus = input.filters.feeStatus;
    if (input.filters?.applicationStatus) where.applicationStatus = input.filters.applicationStatus;
  } else if (input.targetType === "classStart") {
    where.courseId = input.courseId;
    where.applicationStatus = "APPROVED";
    where.accessStatus = "active";
  } else if (input.targetType === "custom") {
    where.id = { in: [] };
  }

  return where;
}

export async function resolveEnrollmentEmailRecipients(input: EmailRequest) {
  const enrollments = await prisma.enrollment.findMany({
    where: enrollmentWhere(input),
    include: {
      user: { select: { id: true, email: true, name: true } },
      course: { select: { startDate: true, title: true } }
    },
    orderBy: { createdAt: "desc" },
  });

  const recipients: ResolvedRecipient[] = [];
  const skipped: SkippedRecipient[] = [];
  const seen = new Set<string>();

  for (const enrollment of enrollments) {
    const vars = enrollmentVariables(enrollment, input);
    const email = vars.email;
    const fullName = vars.fullName;
    const key = email.toLowerCase();

    if (!EMAIL_RE.test(email)) {
      skipped.push({ enrollmentId: enrollment.id, email: email || "(missing email)", fullName, reason: "Invalid or missing email" });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ enrollmentId: enrollment.id, email, fullName, reason: "Duplicate email" });
      continue;
    }

    seen.add(key);
    recipients.push({ enrollmentId: enrollment.id, email, fullName, variables: vars });
  }

  for (const custom of input.customRecipients || []) {
    const vars = customVariables(custom, input);
    const email = vars.email;
    const fullName = vars.fullName;
    const key = email.toLowerCase();

    if (!EMAIL_RE.test(email)) {
      skipped.push({ email: email || "(missing email)", fullName, reason: "Invalid or missing custom email" });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ email, fullName, reason: "Duplicate email" });
      continue;
    }

    seen.add(key);
    recipients.push({ email, fullName, variables: vars });
  }

  return { recipients, skipped };
}

export async function previewEnrollmentEmailCampaign(input: EmailRequest) {
  const { recipients, skipped } = await resolveEnrollmentEmailRecipients(input);
  const sampleRecipient = recipients[0] || null;

  return {
    count: recipients.length,
    skippedCount: skipped.length,
    recipients: recipients.map((recipient) => ({
      enrollmentId: recipient.enrollmentId,
      email: recipient.email,
      fullName: recipient.fullName,
      interestedCourse: recipient.variables.interestedCourse,
      fee: recipient.variables.fee,
      feeStatus: recipient.variables.feeStatus,
      accessStatus: recipient.variables.accessStatus,
    })),
    skipped,
    sample: sampleRecipient
      ? {
          email: sampleRecipient.email,
          subject: renderTemplate(input.subject, sampleRecipient.variables),
          body: renderTemplate(input.body, sampleRecipient.variables),
        }
      : null,
    variables: TEMPLATE_VARIABLES,
  };
}

export async function sendEnrollmentEmailCampaign(input: EmailRequest, adminUser: any) {
  const { recipients, skipped } = await resolveEnrollmentEmailRecipients(input);

  // Save one campaign summary record to DB (lightweight — just metadata)
  const campaign = await prisma.emailCampaign.create({
    data: {
      subject: input.subject,
      body: input.body,
      targetType: input.targetType,
      targetFilters: {
        filters: input.filters || {},
        selectedEnrollmentIds: input.selectedEnrollmentIds || [],
        customRecipients: input.customRecipients || [],
      },
      totalCount: recipients.length + skipped.length,
      skippedCount: skipped.length,
      createdById: adminUser?.id || null,
      createdByEmail: adminUser?.email || null,
    },
  });

  // Send all emails in parallel and collect results
  const results = await Promise.allSettled(
    recipients.map(async (recipient) => {
      const renderedSubject = renderTemplate(input.subject, recipient.variables);
      const renderedBody = renderTemplate(input.body, recipient.variables);

      try {
        const result = await sendEnrollmentCampaignEmail(
          recipient.email,
          renderedSubject,
          renderedBody,
          `enrollment-campaign/${campaign.id}`,
        );

        if (result.error) {
          return { status: "failed" };
        }

        return { status: "sent" };
      } catch {
        return { status: "failed" };
      }
    })
  );

  // Tally up results
  let sentCount = 0;
  let failedCount = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.status === "sent") sentCount++;
    else failedCount++;
  }

  // One final DB update with the summary counts — no per-row writes at all
  return prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: { sentCount, failedCount, skippedCount: skipped.length },
  });
}

