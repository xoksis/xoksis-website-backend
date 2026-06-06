import prisma from "../config/prisma";
import { sendEnrollmentConfirmation, sendReferralUpdateEmail } from "../services/emailService";
import { recalculateUserFees } from "../services/referralService";
import { ensureDefaultEnrollmentEmailTemplates, getTemplateVariables, previewEnrollmentEmailCampaign, sendEnrollmentEmailCampaign, } from "../services/enrollmentEmailService";
export const submitEnrollment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { fullName, email, contactNumber, gender, genderOther, courseId, isHafizQuran, isOrphan, disability, referralDetails, referralCodeUsed, } = req.body;
        if (!fullName || !email || !contactNumber || !gender || !courseId) {
            return res.status(400).json({ message: "Please fill in all required fields" });
        }
        // Verify course exists
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) {
            return res.status(404).json({ message: "Course not found" });
        }
        // Bug #8: Prevent duplicate enrollments on self-service path
        const existingEnrollment = await prisma.enrollment.findFirst({
            where: { userId, courseId },
        });
        if (existingEnrollment) {
            return res.status(400).json({ message: "You are already enrolled in this course" });
        }
        // Look up referrer if a referral code is used
        let referrerId = null;
        let cleanReferralCode = null;
        if (referralCodeUsed && referralCodeUsed.trim() !== "") {
            const codeToQuery = referralCodeUsed.trim().toUpperCase();
            cleanReferralCode = codeToQuery;
            // Check if code is valid and belongs to another user
            const referrerUser = await prisma.user.findUnique({
                where: { referralCode: codeToQuery },
            });
            if (!referrerUser) {
                return res.status(400).json({ message: "Invalid referral code" });
            }
            // Prevent user from using their own referral code
            if (referrerUser.id === userId) {
                return res.status(400).json({ message: "You cannot use your own referral code" });
            }
            referrerId = referrerUser.id;
        }
        const enrollment = await prisma.enrollment.create({
            data: {
                userId,
                courseId,
                fullName,
                email,
                contactNumber,
                gender,
                genderOther: genderOther || null,
                isHafizQuran: Boolean(isHafizQuran),
                isOrphan: Boolean(isOrphan),
                disability: disability || null,
                referralDetails: referralDetails || null,
                referralCodeUsed: cleanReferralCode,
                referrerId,
                applicationStatus: "APPROVED",
                accessStatus: "active",
                feeTier: "free",
                fee: 0,
                feeStatus: "unpaid",
            },
            include: {
                course: true,
                user: true,
            },
        });
        const studentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { referralCode: true },
        });
        sendEnrollmentConfirmation(enrollment.email, enrollment.fullName, enrollment.course.title, studentUser?.referralCode || undefined);
        // Recalculate fees for the referrer (fire-and-forget, doesn't block the response)
        if (referrerId) {
            recalculateUserFees(referrerId).catch(console.error);
        }
        res.status(201).json({ message: "Application submitted successfully", enrollment });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to submit application", error: error.message });
    }
};
// GET /api/enrollments/mine — returns only the logged-in user's enrollments with course details
export const getMyEnrollments = async (req, res) => {
    try {
        const userId = req.user.id;
        const enrollments = await prisma.enrollment.findMany({
            where: { userId },
            include: {
                course: {
                    select: {
                        id: true, title: true, image: true, cat: true, tag: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(enrollments);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch your enrollments", error: error.message });
    }
};
export const getEnrollments = async (req, res) => {
    try {
        const { feeTier, accessStatus, feeStatus, courseCompleted, applicationStatus } = req.query;
        const where = {};
        if (feeTier)
            where.feeTier = feeTier;
        if (accessStatus)
            where.accessStatus = accessStatus;
        if (feeStatus)
            where.feeStatus = feeStatus;
        if (applicationStatus)
            where.applicationStatus = applicationStatus;
        if (courseCompleted !== undefined && courseCompleted !== "") {
            where.courseCompleted = courseCompleted === "true";
        }
        // Fetch enrollments and active-referral counts in parallel (2 queries, not N+1)
        const [enrollments, referralCounts] = await Promise.all([
            prisma.enrollment.findMany({
                where,
                include: {
                    user: { select: { id: true, email: true, name: true, referralCode: true } },
                    course: { select: { id: true, title: true } },
                    referrer: { select: { id: true, email: true, name: true, referralCode: true } },
                },
                orderBy: { createdAt: "desc" },
            }),
            // Single aggregated query instead of 1 subquery per enrollment row
            prisma.enrollment.groupBy({
                by: ["referrerId"],
                where: { feeTier: "standard", applicationStatus: "APPROVED", accessStatus: "active", referrerId: { not: null } },
                _count: { id: true },
            }),
        ]);
        // Build a fast O(1) lookup map: userId → activeReferralCount
        const referralCountMap = new Map();
        for (const row of referralCounts) {
            if (row.referrerId)
                referralCountMap.set(row.referrerId, row._count.id);
        }
        // Attach referral stats to each enrollment's user without extra DB calls
        const enriched = enrollments.map((e) => ({
            ...e,
            user: {
                ...e.user,
                activeReferralCount: referralCountMap.get(e.user.id) ?? 0,
            },
        }));
        res.json(enriched);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch enrollments", error: error.message });
    }
};
export const updateEnrollment = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { applicationStatus, accessStatus, courseCompleted, feeTier, fee, feeStatus, feeNotes, } = req.body;
        if (applicationStatus && !["PENDING", "APPROVED", "REJECTED"].includes(applicationStatus))
            return res.status(400).json({ message: "Invalid applicationStatus" });
        if (accessStatus && !["active", "revoked"].includes(accessStatus))
            return res.status(400).json({ message: "Invalid accessStatus" });
        if (feeTier && !["free", "standard"].includes(feeTier))
            return res.status(400).json({ message: "Invalid feeTier" });
        if (feeStatus && !["unpaid", "partial", "paid"].includes(feeStatus))
            return res.status(400).json({ message: "Invalid feeStatus" });
        const data = {};
        if (applicationStatus !== undefined)
            data.applicationStatus = applicationStatus;
        if (accessStatus !== undefined)
            data.accessStatus = accessStatus;
        if (courseCompleted !== undefined)
            data.courseCompleted = courseCompleted;
        if (feeTier !== undefined)
            data.feeTier = feeTier;
        if (fee !== undefined)
            data.fee = fee;
        if (feeStatus !== undefined)
            data.feeStatus = feeStatus;
        if (feeNotes !== undefined)
            data.feeNotes = feeNotes;
        // Bug #2 fix: findUnique must run BEFORE update to get an accurate pre-update snapshot.
        // Running them in parallel risks reading state after the update has already committed.
        const oldEnrollment = await prisma.enrollment.findUnique({ where: { id } });
        const enrollment = await prisma.enrollment.update({
            where: { id },
            data,
            include: {
                user: { select: { id: true, email: true, name: true } },
                course: { select: { title: true } },
            },
        });
        // Run student fee recalculation and referrer logic in parallel
        const referrerPromise = (async () => {
            if (!oldEnrollment?.referrerId)
                return;
            const wasActiveStandard = oldEnrollment.feeTier === "standard" &&
                oldEnrollment.applicationStatus === "APPROVED" &&
                oldEnrollment.accessStatus === "active";
            const isActiveStandardNow = enrollment.feeTier === "standard" &&
                enrollment.applicationStatus === "APPROVED" &&
                enrollment.accessStatus === "active";
            // Run referrer fee recalculation always; email notification only on upgrade
            if (!wasActiveStandard && isActiveStandardNow) {
                // Parallel: fetch referrer user + counts at the same time
                const [referrerUser, activeReferralsCount] = await Promise.all([
                    prisma.user.findUnique({ where: { id: oldEnrollment.referrerId } }),
                    prisma.enrollment.count({
                        where: {
                            referrerId: oldEnrollment.referrerId,
                            feeTier: "standard",
                            applicationStatus: "APPROVED",
                            accessStatus: "active",
                        },
                    }),
                ]);
                if (referrerUser) {
                    const newDiscount = activeReferralsCount * 500;
                    const newFee = Math.max(0, 2500 - newDiscount);
                    // Fire-and-forget email — don't block the response
                    sendReferralUpdateEmail(referrerUser.email, referrerUser.name || referrerUser.firstName || "there", enrollment.fullName || enrollment.user.name || "A friend", enrollment.course?.title || "a course", newDiscount, newFee).catch(console.error);
                }
            }
            recalculateUserFees(oldEnrollment.referrerId).catch(console.error);
        })();
        // Both recalculations fire at once, don't block the HTTP response
        await Promise.all([
            referrerPromise,
            recalculateUserFees(enrollment.userId),
        ]);
        res.json(enrollment);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update enrollment", error: error.message });
    }
};
export const deleteEnrollment = async (req, res) => {
    try {
        const id = String(req.params.id);
        // Bug #1 fix: check existence before delete to return clean 404 instead of raw DB error
        const enrollment = await prisma.enrollment.findUnique({ where: { id } });
        if (!enrollment) {
            return res.status(404).json({ message: "Enrollment not found" });
        }
        await prisma.enrollment.delete({ where: { id } });
        // Fire-and-forget fee recalculation — don't block the delete response
        if (enrollment.referrerId) {
            recalculateUserFees(enrollment.referrerId).catch(console.error);
        }
        res.json({ message: "Enrollment deleted" });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to delete enrollment", error: error.message });
    }
};
export const getEnrollmentEmailTemplates = async (_req, res) => {
    try {
        await ensureDefaultEnrollmentEmailTemplates();
        const templates = await prisma.emailTemplate.findMany({
            orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        });
        res.json({ templates, variables: getTemplateVariables() });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch email templates", error: error.message });
    }
};
export const createEnrollmentEmailTemplate = async (req, res) => {
    try {
        const { name, subject, body, category } = req.body;
        if (!name || !subject || !body) {
            return res.status(400).json({ message: "Template name, subject, and body are required" });
        }
        const template = await prisma.emailTemplate.create({
            data: {
                key: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name,
                subject,
                body,
                category: category || "general",
                isDefault: false,
            },
        });
        res.status(201).json(template);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create email template", error: error.message });
    }
};
export const updateEnrollmentEmailTemplate = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, subject, body, category } = req.body;
        if (!name || !subject || !body) {
            return res.status(400).json({ message: "Template name, subject, and body are required" });
        }
        const template = await prisma.emailTemplate.update({
            where: { id },
            data: {
                name,
                subject,
                body,
                category: category || "general",
            },
        });
        res.json(template);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update email template", error: error.message });
    }
};
function validateEmailCampaignPayload(body) {
    if (!body?.subject || !body?.body)
        return "Email subject and body are required";
    if (!body?.targetType)
        return "Target type is required";
    return "";
}
export const previewEnrollmentEmail = async (req, res) => {
    try {
        const invalid = validateEmailCampaignPayload(req.body);
        if (invalid)
            return res.status(400).json({ message: invalid });
        const preview = await previewEnrollmentEmailCampaign(req.body);
        res.json(preview);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to preview email campaign", error: error.message });
    }
};
export const sendEnrollmentEmail = async (req, res) => {
    try {
        const invalid = validateEmailCampaignPayload(req.body);
        if (invalid)
            return res.status(400).json({ message: invalid });
        const campaign = await sendEnrollmentEmailCampaign(req.body, req.user);
        res.status(201).json(campaign);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to send email campaign", error: error.message });
    }
};
export const getEnrollmentEmailCampaigns = async (_req, res) => {
    try {
        const campaigns = await prisma.emailCampaign.findMany({
            orderBy: { createdAt: "desc" },
            take: 25,
        });
        res.json(campaigns);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch email campaigns", error: error.message });
    }
};
export const createEnrollmentManually = async (req, res) => {
    try {
        const { userId, courseId, feeTier, fee, feeStatus, accessStatus } = req.body;
        if (!userId || !courseId) {
            return res.status(400).json({ message: "userId and courseId are required" });
        }
        // Verify user exists
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        // Verify course exists
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) {
            return res.status(404).json({ message: "Course not found" });
        }
        // Check if enrollment already exists
        const existing = await prisma.enrollment.findFirst({
            where: { userId, courseId },
        });
        if (existing) {
            return res.status(400).json({ message: "User is already enrolled in this course" });
        }
        const enrollment = await prisma.enrollment.create({
            data: {
                userId,
                courseId,
                feeTier: feeTier || "free",
                fee: fee !== undefined ? fee : 2500,
                feeStatus: feeStatus || "unpaid",
                accessStatus: accessStatus || "active",
                applicationStatus: "APPROVED",
            },
            include: {
                user: { select: { id: true, email: true, name: true } },
                course: { select: { id: true, title: true } },
            },
        });
        res.status(201).json({ message: "Enrollment created successfully", enrollment });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create enrollment", error: error.message });
    }
};
