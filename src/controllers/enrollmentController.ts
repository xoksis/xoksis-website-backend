import type { Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { sendEnrollmentConfirmation, sendReferralUpdateEmail, sendNewEnrollmentCredentials } from "../services/emailService";
import { recalculateUserFees, generateUniqueReferralCode } from "../services/referralService";
import { generateSecurePassword, generateSecureAlphanumeric } from "../utils/secureRandom";
import {
  ensureDefaultEnrollmentEmailTemplates,
  getTemplateVariables,
  previewEnrollmentEmailCampaign,
  sendEnrollmentEmailCampaign,
} from "../services/enrollmentEmailService";
import { getInitialEnrollmentStatus } from "../config/enrollmentConfig";
import { validateEnrollmentEnums } from "../utils/enrollmentValidation";

const isDev = process.env.NODE_ENV !== "production";

export const submitEnrollment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      fullName, email: emailFromBody, contactNumber, gender, genderOther,
      courseId, isHafizQuran, isOrphan, disability, referralDetails,
      referralCodeUsed,
    } = req.body;

    const accountUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, referralCode: true },
    });
    if (!accountUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!fullName || !contactNumber || !gender || !courseId) {
      return res.status(400).json({ message: "Please fill in all required fields" });
    }

    if (
      emailFromBody &&
      String(emailFromBody).trim().toLowerCase() !== accountUser.email.toLowerCase()
    ) {
      return res.status(400).json({ message: "Enrollment must use your account email." });
    }

    const enrollmentEmail = accountUser.email;

    // Verify course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Prevent duplicate enrollments on self-service path
    const existingEnrollment = await prisma.enrollment.findFirst({
      where: { userId, courseId },
    });
    if (existingEnrollment) {
      return res.status(400).json({ message: "You are already enrolled in this course" });
    }

    // Look up referrer if a referral code is used
    let referrerId: string | null = null;
    let cleanReferralCode: string | null = null;
    if (referralCodeUsed && referralCodeUsed.trim() !== "") {
      const codeToQuery = referralCodeUsed.trim().toUpperCase();
      cleanReferralCode = codeToQuery;

      const referrerUser = await prisma.user.findUnique({
        where: { referralCode: codeToQuery },
      });

      if (!referrerUser) {
        return res.status(400).json({ message: "Invalid referral code" });
      }

      if (referrerUser.id === userId) {
        return res.status(400).json({ message: "You cannot use your own referral code" });
      }

      referrerId = referrerUser.id;
    }

    const { applicationStatus, accessStatus } = getInitialEnrollmentStatus();

    const enrollment = await prisma.enrollment.create({
      data: {
        userId,
        courseId,
        fullName,
        email: enrollmentEmail,
        contactNumber,
        gender,
        genderOther: genderOther || null,
        isHafizQuran: Boolean(isHafizQuran),
        isOrphan: Boolean(isOrphan),
        disability: disability || null,
        referralDetails: referralDetails || null,
        referralCodeUsed: cleanReferralCode,
        referrerId,
        applicationStatus,
        accessStatus,
        feeTier: "free",
        fee: 0,
        feeStatus: "unpaid",
      },
      include: {
        course: true,
        user: true,
      },
    });

    sendEnrollmentConfirmation(
      enrollmentEmail,
      enrollment.fullName!,
      enrollment.course.title,
      accountUser.referralCode || undefined,
      applicationStatus === "APPROVED",
    );

    // Recalculate fees for the referrer (fire-and-forget, doesn't block the response)
    if (referrerId) {
      recalculateUserFees(referrerId).catch(console.error);
    }

    res.status(201).json({
      message: applicationStatus === "APPROVED"
        ? "Enrollment confirmed! You can access your course from the dashboard."
        : "Application submitted successfully. Our team will review it shortly.",
      enrollment,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to submit application", ...(isDev && { error: error.message }) });
  }
};

// GET /api/enrollments/mine — returns only the logged-in user's enrollments with course details
export const getMyEnrollments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      include: {
        course: {
          select: {
            id: true, title: true, image: true, cat: true, tag: true,
            level: true, hours: true, desc: true, instructorName: true, badge: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(enrollments);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch your enrollments", ...(isDev && { error: error.message }) });
  }
};

export const getEnrollments = async (req: AuthRequest, res: Response) => {
  try {
    const { feeTier, accessStatus, feeStatus, courseCompleted, applicationStatus } = req.query;

    const where: any = {};
    if (feeTier) where.feeTier = feeTier;
    if (accessStatus) where.accessStatus = accessStatus;
    if (feeStatus) where.feeStatus = feeStatus;
    if (applicationStatus) where.applicationStatus = applicationStatus;
    if (courseCompleted !== undefined && courseCompleted !== "") {
      where.courseCompleted = courseCompleted === "true";
    }

    // Fetch enrollments and active-referral counts in parallel (2 queries, not N+1)
    const [enrollments, referralCounts] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        include: {
          user: { 
            select: { 
              id: true, 
              email: true, 
              name: true, 
              referralCode: true,
              referralsReceived: { select: { id: true, fullName: true, email: true } }
            } 
          },
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
    const referralCountMap = new Map<string, number>();
    for (const row of referralCounts) {
      if (row.referrerId) referralCountMap.set(row.referrerId, row._count.id);
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
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch enrollments", ...(isDev && { error: error.message }) });
  }
};

export const updateEnrollment = async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const {
      applicationStatus, accessStatus, courseCompleted,
      feeTier, fee, feeStatus, feeNotes,
      email, contactNumber, gender, isHafizQuran, isOrphan, disability, referralDetails,
      referralCodeUsed,
    } = req.body;

    if (applicationStatus && !["PENDING", "APPROVED", "REJECTED"].includes(applicationStatus))
      return res.status(400).json({ message: "Invalid applicationStatus" });
    if (accessStatus && !["active", "revoked"].includes(accessStatus))
      return res.status(400).json({ message: "Invalid accessStatus" });
    if (feeTier && !["free", "standard"].includes(feeTier))
      return res.status(400).json({ message: "Invalid feeTier" });
    if (feeStatus && !["unpaid", "partial", "paid"].includes(feeStatus))
      return res.status(400).json({ message: "Invalid feeStatus" });

    const oldEnrollment = await prisma.enrollment.findUnique({ where: { id } });
    if (!oldEnrollment) {
      return res.status(404).json({ message: "Enrollment not found" });
    }

    const data: any = {};
    if (applicationStatus !== undefined) data.applicationStatus = applicationStatus;
    if (accessStatus      !== undefined) data.accessStatus      = accessStatus;
    if (courseCompleted   !== undefined) data.courseCompleted   = courseCompleted;
    if (feeTier           !== undefined) data.feeTier           = feeTier;
    if (fee               !== undefined) data.fee               = fee;
    if (feeStatus         !== undefined) data.feeStatus         = feeStatus;
    if (feeNotes          !== undefined) data.feeNotes          = feeNotes;
    if (email             !== undefined) data.email             = email;
    if (contactNumber     !== undefined) data.contactNumber     = contactNumber;
    if (gender            !== undefined) data.gender            = gender;
    if (isHafizQuran      !== undefined) data.isHafizQuran      = isHafizQuran;
    if (isOrphan          !== undefined) data.isOrphan          = isOrphan;
    if (disability        !== undefined) data.disability        = disability;
    if (referralDetails   !== undefined) data.referralDetails   = referralDetails;

    let referralAssigned = false;
    if (referralCodeUsed !== undefined) {
      const trimmed = String(referralCodeUsed).trim();
      if (trimmed === "") {
        return res.status(400).json({ message: "Referral code cannot be empty" });
      }

      const codeToQuery = trimmed.toUpperCase();
      const referrerUser = await prisma.user.findUnique({
        where: { referralCode: codeToQuery },
      });

      if (!referrerUser) {
        return res.status(400).json({ message: `Referral code "${codeToQuery}" is invalid or does not exist` });
      }

      if (referrerUser.id === oldEnrollment.userId) {
        return res.status(400).json({ message: "Cannot use your own referral code" });
      }

      if (oldEnrollment.referrerId !== referrerUser.id) {
        data.referralCodeUsed = codeToQuery;
        data.referrerId = referrerUser.id;
        referralAssigned = true;
      }
    }

    const enrollment = await prisma.enrollment.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, email: true, name: true, referralCode: true, referralsReceived: { select: { id: true, fullName: true, email: true } } } },
        course: { select: { id: true, title: true } },
        referrer: { select: { id: true, email: true, name: true, referralCode: true } },
      },
    });

    const isActiveStandard = (e: { feeTier: string; applicationStatus: string; accessStatus: string }) =>
      e.feeTier === "standard" && e.applicationStatus === "APPROVED" && e.accessStatus === "active";

    const wasActiveStandard = isActiveStandard(oldEnrollment);
    const isActiveStandardNow = isActiveStandard(enrollment);

    const referrerIdsToRecalc = new Set<string>();
    if (oldEnrollment.referrerId) referrerIdsToRecalc.add(oldEnrollment.referrerId);
    if (enrollment.referrerId) referrerIdsToRecalc.add(enrollment.referrerId);

    const referrerPromise = (async () => {
      const notifyReferrerId =
        referralAssigned && isActiveStandardNow && enrollment.referrerId
          ? enrollment.referrerId
          : !wasActiveStandard && isActiveStandardNow && enrollment.referrerId
            ? enrollment.referrerId
            : null;

      if (notifyReferrerId) {
        const [referrerUser, activeReferralsCount] = await Promise.all([
          prisma.user.findUnique({ where: { id: notifyReferrerId } }),
          prisma.enrollment.count({
            where: {
              referrerId: notifyReferrerId,
              feeTier: "standard",
              applicationStatus: "APPROVED",
              accessStatus: "active",
            },
          }),
        ]);

        if (referrerUser) {
          const newDiscount = activeReferralsCount * 500;
          const newFee = Math.max(0, 2500 - newDiscount);
          sendReferralUpdateEmail(
            referrerUser.email,
            referrerUser.name || referrerUser.firstName || "there",
            enrollment.fullName || enrollment.user.name || "A friend",
            enrollment.course?.title || "a course",
            newDiscount,
            newFee
          ).catch(console.error);
        }
      }

      await Promise.all([...referrerIdsToRecalc].map((rid) => recalculateUserFees(rid)));
    })();

    await Promise.all([
      referrerPromise,
      recalculateUserFees(enrollment.userId),
    ]);

    res.json(enrollment);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to update enrollment", ...(isDev && { error: error.message }) });
  }
};

export const deleteEnrollment = async (req: AuthRequest, res: Response) => {
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
  } catch (error: any) {
    res.status(500).json({ message: "Failed to delete enrollment", ...(isDev && { error: error.message }) });
  }
};

export const getEnrollmentEmailTemplates = async (_req: AuthRequest, res: Response) => {
  try {
    await ensureDefaultEnrollmentEmailTemplates();
    const templates = await prisma.emailTemplate.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    res.json({ templates, variables: getTemplateVariables() });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch email templates", ...(isDev && { error: error.message }) });
  }
};

export const createEnrollmentEmailTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { name, subject, body, category } = req.body;
    if (!name || !subject || !body) {
      return res.status(400).json({ message: "Template name, subject, and body are required" });
    }

    const template = await prisma.emailTemplate.create({
      data: {
        key: `custom-${Date.now()}-${generateSecureAlphanumeric(8)}`,
        name,
        subject,
        body,
        category: category || "general",
        isDefault: false,
      },
    });

    res.status(201).json(template);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to create email template", ...(isDev && { error: error.message }) });
  }
};

export const updateEnrollmentEmailTemplate = async (req: AuthRequest, res: Response) => {
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
  } catch (error: any) {
    res.status(500).json({ message: "Failed to update email template", ...(isDev && { error: error.message }) });
  }
};

function validateEmailCampaignPayload(body: any) {
  if (!body?.subject || !body?.body) return "Email subject and body are required";
  if (!body?.targetType) return "Target type is required";
  return "";
}

export const previewEnrollmentEmail = async (req: AuthRequest, res: Response) => {
  try {
    const invalid = validateEmailCampaignPayload(req.body);
    if (invalid) return res.status(400).json({ message: invalid });

    const preview = await previewEnrollmentEmailCampaign(req.body);
    res.json(preview);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to preview email campaign", ...(isDev && { error: error.message }) });
  }
};

export const sendEnrollmentEmail = async (req: AuthRequest, res: Response) => {
  try {
    const invalid = validateEmailCampaignPayload(req.body);
    if (invalid) return res.status(400).json({ message: invalid });

    const campaign = await sendEnrollmentEmailCampaign(req.body, req.user);
    res.status(201).json(campaign);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to send email campaign", ...(isDev && { error: error.message }) });
  }
};

export const getEnrollmentEmailCampaigns = async (_req: AuthRequest, res: Response) => {
  try {
    const campaigns = await prisma.emailCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    res.json(campaigns);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch email campaigns", ...(isDev && { error: error.message }) });
  }
};

export const createEnrollmentManually = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      userId, courseId, feeTier, fee, feeStatus, accessStatus,
      email, firstName, lastName, createUser,
      contactNumber, gender, isHafizQuran, isOrphan, disability, referralDetails,
      referralCodeUsed
    } = req.body;

    if (!courseId) {
      return res.status(400).json({ message: "courseId is required" });
    }

    const enumCheck = validateEnrollmentEnums({ feeTier, feeStatus, accessStatus, fee });
    if (!enumCheck.ok) {
      return res.status(400).json({ message: enumCheck.message });
    }

    // Verify course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    let finalUserId = userId;
    let generatedPassword: string | null = null;
    let newUserEmail: string | null = null;
    let referrerId: string | null = null;

    // Create new user if requested
    if (createUser && email) {
      if (!firstName || !lastName) {
        return res.status(400).json({ message: "firstName and lastName are required when creating new user" });
      }

      // Check if user with email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }

      // Generate random 8-digit password
      generatedPassword = generateSecurePassword(12);
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);

      // Generate unique referral code
      const referralCode = await generateUniqueReferralCode();

      // Create new user with defaults
      const newUser = await prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`,
          password: hashedPassword,
          country: "Pakistan",
          onboardingDone: true,
          emailVerified: true,
          authProvider: "manual",
          referralCode,
        },
      });

      finalUserId = newUser.id;
      newUserEmail = email;
    } else if (!userId) {
      return res.status(400).json({ message: "userId or createUser with email are required" });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: finalUserId } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if enrollment already exists
    const existing = await prisma.enrollment.findFirst({
      where: { userId: finalUserId, courseId },
    });
    if (existing) {
      return res.status(400).json({ message: "User is already enrolled in this course" });
    }

    // Validate referral code if provided
    if (referralCodeUsed && referralCodeUsed.trim() !== "") {
      const codeToQuery = referralCodeUsed.trim().toUpperCase();

      // Check if referral code exists and belongs to another user
      const referrerUser = await prisma.user.findUnique({
        where: { referralCode: codeToQuery },
      });

      if (!referrerUser) {
        return res.status(400).json({ message: `Referral code "${codeToQuery}" is invalid or does not exist` });
      }

      if (referrerUser.id === finalUserId) {
        return res.status(400).json({ message: "Cannot use your own referral code" });
      }

      referrerId = referrerUser.id;
    }

    const { applicationStatus: defaultAppStatus, accessStatus: defaultAccessStatus } = getInitialEnrollmentStatus();

    const enrollment = await prisma.enrollment.create({
      data: {
        userId: finalUserId,
        courseId,
        feeTier: feeTier || "free",
        fee: fee !== undefined ? fee : 2500,
        feeStatus: feeStatus || "unpaid",
        accessStatus: accessStatus || defaultAccessStatus,
        applicationStatus: defaultAppStatus,
        contactNumber: contactNumber || null,
        gender: gender || null,
        isHafizQuran: isHafizQuran === true,
        isOrphan: isOrphan === true,
        disability: disability || null,
        referralDetails: referralDetails || null,
        referrerId: referrerId,
        referralCodeUsed: referralCodeUsed ? referralCodeUsed.trim().toUpperCase() : null,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            referralCode: true,
            referralsReceived: { select: { id: true, fullName: true, email: true } },
          },
        },
        course: { select: { id: true, title: true } },
        referrer: { select: { id: true, email: true, name: true, referralCode: true } },
      },
    });

    if (referrerId) {
      recalculateUserFees(referrerId).catch(console.error);
    }

    // Send credentials email if user was newly created
    if (newUserEmail && generatedPassword && enrollment.user.referralCode) {
      try {
        await sendNewEnrollmentCredentials(
          newUserEmail,
          firstName || user.name || "Student",
          course.title,
          generatedPassword,
          enrollment.feeTier as "free" | "standard",
          enrollment.fee,
          enrollment.user.referralCode
        );
      } catch (emailErr) {
        console.error("Failed to send credentials email:", emailErr);
        // Don't fail the enrollment if email fails
      }
    }

    res.status(201).json({ message: "Enrollment created successfully", enrollment });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to create enrollment", ...(isDev && { error: error.message }) });
  }
};
