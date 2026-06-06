import prisma from "../config/prisma";
import { sendEnrollmentCampaignEmail } from "./emailService";
import fs from "fs";
import path from "path";
// ── Campaign file logger ─────────────────────────────────────────────────────
// Logs are written to: backend/logs/campaigns.log
// Each line is a JSON object (JSON Lines format) for easy parsing/grep.
const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "campaigns.log");
function campaignLog(entry) {
    try {
        if (!fs.existsSync(LOG_DIR))
            fs.mkdirSync(LOG_DIR, { recursive: true });
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
        fs.appendFileSync(LOG_FILE, line, "utf8");
    }
    catch {
        // Never crash the request over a logging failure
    }
}
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
        body: "Hi {{fullName}},\n\nYour enrollment for {{interestedCourse}} is active, but your fee status is {{feeStatus}}.\n\nAmount due: Rs. {{fee}}\nNotes: {{feeNotes}}\n\nPlease complete your payment so our team can finalize your learning access.\n\nRegards,\nXOKSIS Team",
        isDefault: true,
    },
    {
        key: "partial-payment-reminder",
        name: "Partial Payment Reminder",
        category: "fee",
        subject: "Remaining payment reminder - {{interestedCourse}}",
        body: "Hi {{fullName}},\n\nThank you for your partial payment for {{interestedCourse}}.\n\nCurrent fee status: {{feeStatus}}\nTotal fee: Rs. {{fee}}\nNotes: {{feeNotes}}\n\nPlease clear the remaining amount to keep your enrollment in good standing.\n\nRegards,\nXOKSIS Team",
        isDefault: true,
    },
    {
        key: "paid-confirmation",
        name: "Paid Confirmation",
        category: "fee",
        subject: "Payment confirmed for {{interestedCourse}}",
        body: "Hi {{fullName}},\n\nYour payment for {{interestedCourse}} has been marked as {{feeStatus}}.\n\nThank you for completing your registration with XOKSIS.\n\nRegards,\nXOKSIS Team",
        isDefault: true,
    },
    {
        key: "revoked-access-notice",
        name: "Revoked Access Notice",
        category: "access",
        subject: "Enrollment access update",
        body: "Hi {{fullName}},\n\nYour access status for {{interestedCourse}} is currently {{accessStatus}}.\n\nIf you believe this is a mistake, please contact the XOKSIS team with your enrollment details.\n\nRegards,\nXOKSIS Team",
        isDefault: true,
    },
    {
        key: "general-announcement",
        name: "General Announcement",
        category: "general",
        subject: "Update from XOKSIS",
        body: "Hi {{fullName}},\n\nWe have an update about your enrollment for {{interestedCourse}}.\n\nRegards,\nXOKSIS Team",
        isDefault: true,
    },
    {
        key: "class-start-notification",
        name: "Class Start Notification",
        category: "general",
        subject: "Class starting soon: {{interestedCourse}}",
        body: "Hi {{fullName}},\n\nThis is a notification that classes for {{interestedCourse}} will start on {{courseStartDate}} (in {{classStartInDays}} days and {{classStartInHours}} hours).\n\nPlease make sure you are prepared and check your portal for instructions.\n\nRegards,\nXOKSIS Team",
        isDefault: true,
    },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const getTemplateVariables = () => TEMPLATE_VARIABLES;
// Run only once per server lifetime — not on every admin page view
let templatesInitialized = false;
export async function ensureDefaultEnrollmentEmailTemplates() {
    if (templatesInitialized)
        return;
    templatesInitialized = true;
    for (const template of DEFAULT_TEMPLATES) {
        await prisma.emailTemplate.upsert({
            where: { key: template.key },
            update: {},
            create: template,
        });
    }
}
function clean(value, fallback = "N/A") {
    if (value === null || value === undefined || value === "")
        return fallback;
    return String(value);
}
function renderTemplate(template, variables) {
    return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
        return clean(variables[key]);
    });
}
function enrollmentVariables(enrollment, input) {
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
function customVariables(recipient, input) {
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
function enrollmentWhere(input) {
    const where = {};
    if (input.targetType === "selected") {
        where.id = { in: input.selectedEnrollmentIds || [] };
    }
    else if (["unpaid", "partial", "paid"].includes(input.targetType)) {
        where.feeStatus = input.targetType;
    }
    else if (input.targetType === "revoked") {
        where.accessStatus = "revoked";
    }
    else if (input.targetType === "currentFilters") {
        if (input.filters?.feeTier)
            where.feeTier = input.filters.feeTier;
        if (input.filters?.accessStatus)
            where.accessStatus = input.filters.accessStatus;
        if (input.filters?.feeStatus)
            where.feeStatus = input.filters.feeStatus;
        if (input.filters?.applicationStatus)
            where.applicationStatus = input.filters.applicationStatus;
    }
    else if (input.targetType === "classStart") {
        where.courseId = input.courseId;
        where.applicationStatus = "APPROVED";
        where.accessStatus = "active";
    }
    else if (input.targetType === "custom") {
        where.id = { in: [] };
    }
    return where;
}
export async function resolveEnrollmentEmailRecipients(input) {
    const enrollments = await prisma.enrollment.findMany({
        where: enrollmentWhere(input),
        include: {
            user: { select: { id: true, email: true, name: true } },
            course: { select: { startDate: true, title: true } }
        },
        orderBy: { createdAt: "desc" },
    });
    const recipients = [];
    const skipped = [];
    const seen = new Set();
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
export async function previewEnrollmentEmailCampaign(input) {
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
export async function sendEnrollmentEmailCampaign(input, adminUser) {
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
    // Log skipped recipients to file (not DB)
    for (const item of skipped) {
        campaignLog({
            campaignId: campaign.id,
            status: "skipped",
            email: item.email,
            fullName: item.fullName,
            enrollmentId: item.enrollmentId || null,
            reason: item.reason,
        });
    }
    // Send all emails in parallel and collect results
    const results = await Promise.allSettled(recipients.map(async (recipient) => {
        const renderedSubject = renderTemplate(input.subject, recipient.variables);
        const renderedBody = renderTemplate(input.body, recipient.variables);
        try {
            const result = await sendEnrollmentCampaignEmail(recipient.email, renderedSubject, renderedBody, `enrollment-campaign/${campaign.id}`);
            if (result.error) {
                campaignLog({
                    campaignId: campaign.id,
                    status: "failed",
                    email: recipient.email,
                    fullName: recipient.fullName,
                    enrollmentId: recipient.enrollmentId || null,
                    error: JSON.stringify(result.error).slice(0, 500),
                });
                return { status: "failed" };
            }
            campaignLog({
                campaignId: campaign.id,
                status: "sent",
                email: recipient.email,
                fullName: recipient.fullName,
                enrollmentId: recipient.enrollmentId || null,
                resendId: result.data?.id || null,
            });
            return { status: "sent" };
        }
        catch (error) {
            campaignLog({
                campaignId: campaign.id,
                status: "failed",
                email: recipient.email,
                fullName: recipient.fullName,
                enrollmentId: recipient.enrollmentId || null,
                error: String(error?.message || error).slice(0, 500),
            });
            return { status: "failed" };
        }
    }));
    // Tally up results
    let sentCount = 0;
    let failedCount = 0;
    for (const r of results) {
        if (r.status === "fulfilled" && r.value.status === "sent")
            sentCount++;
        else
            failedCount++;
    }
    // One final DB update with the summary counts — no per-row writes at all
    return prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: { sentCount, failedCount, skippedCount: skipped.length },
    });
}
