import crypto from "crypto";
import prisma from "../config/prisma";

/**
 * Generates a unique referral code with format XOK-XXXXXX
 */
export const generateUniqueReferralCode = async (): Promise<string> => {
  let code = "";
  let isUnique = false;
  while (!isUnique) {
    code = "XOK-" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
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
export const recalculateUserFees = async (userId: string) => {
  const DISCOUNT_PER_REFERRAL = 500;
  const BASE_STANDARD_FEE = 2500;

  const activeReferralsCount = await prisma.enrollment.count({
    where: {
      referrerId: userId,
      feeTier: "standard",
      applicationStatus: "APPROVED",
      accessStatus: "active",
    },
  });

  const discountedFee = Math.max(0, BASE_STANDARD_FEE - activeReferralsCount * DISCOUNT_PER_REFERRAL);

  const updated = await prisma.enrollment.updateMany({
    where: {
      userId,
      feeTier: "standard",
      applicationStatus: "APPROVED",
      accessStatus: "active",
      NOT: { fee: discountedFee },
    },
    data: { fee: discountedFee },
  });

  if (updated.count > 0) {
    console.log(`[Referral] Updated ${updated.count} enrollment(s) for user ${userId} → Rs. ${discountedFee} (Active Referrals: ${activeReferralsCount})`);
  }
};
