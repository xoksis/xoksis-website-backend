import prisma from "../config/prisma";
/**
 * Generates a unique referral code with format XOK-XXXXXX
 */
export const generateUniqueReferralCode = async () => {
    let code = "";
    let isUnique = false;
    while (!isUnique) {
        code = "XOK-" + Math.random().toString(36).substring(2, 8).toUpperCase();
        const existing = await prisma.user.findUnique({
            where: { referralCode: code },
        });
        if (!existing) {
            isUnique = true;
        }
    }
    return code;
};
/**
 * Recalculates tuition fees for a user's standard enrollments
 * based on the number of active standard referrals they have given.
 */
export const recalculateUserFees = async (userId) => {
    const DISCOUNT_PER_REFERRAL = 500;
    const BASE_STANDARD_FEE = 2500;
    // 1. Count active standard referrals given by this user.
    // A referral is active standard if:
    // - referrerId is this user
    // - applicationStatus is APPROVED
    // - accessStatus is active
    // - feeTier is standard
    const activeReferralsCount = await prisma.enrollment.count({
        where: {
            referrerId: userId,
            feeTier: "standard",
            applicationStatus: "APPROVED",
            accessStatus: "active",
        },
    });
    // 2. Update all standard enrollments in a single query (was: 1 UPDATE per enrollment)
    const discountedFee = Math.max(0, BASE_STANDARD_FEE - activeReferralsCount * DISCOUNT_PER_REFERRAL);
    const updated = await prisma.enrollment.updateMany({
        where: {
            userId,
            feeTier: "standard",
            applicationStatus: "APPROVED",
            accessStatus: "active",
            NOT: { fee: discountedFee }, // skip rows that are already correct
        },
        data: { fee: discountedFee },
    });
    if (updated.count > 0) {
        console.log(`[Referral] Updated ${updated.count} enrollment(s) for user ${userId} → Rs. ${discountedFee} (Active Referrals: ${activeReferralsCount})`);
    }
};
