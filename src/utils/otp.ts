import crypto from "crypto";
import prisma from "../config/prisma";

const OTP_TTL_MINUTES = 10;

function getOtpPepper(): string {
  const pepper = process.env.OTP_PEPPER || process.env.JWT_SECRET;
  if (!pepper) {
    throw new Error("OTP_PEPPER or JWT_SECRET must be set for OTP hashing");
  }
  return pepper;
}

export function hashOtp(email: string, otp: string): string {
  return crypto
    .createHmac("sha256", getOtpPepper())
    .update(`${email.trim().toLowerCase()}:${otp}`)
    .digest("hex");
}

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

export async function createOtpRecord(email: string, type: "signup" | "forgot_password"): Promise<string> {
  await prisma.otpRecord.updateMany({
    where: { email, type, used: false },
    data: { used: true },
  });

  const otp = generateOtp();
  const otpHash = hashOtp(email, otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.otpRecord.create({ data: { email, otpHash, type, expiresAt } });

  return otp;
}

// Validates OTP without consuming it (does NOT mark as used on success).
// Increments attempt counter on wrong code so brute-force protection still applies.
export async function peekOtpRecord(
  email: string,
  otp: string,
  type: "signup" | "forgot_password"
): Promise<{ valid: boolean; reason?: string }> {
  const record = await prisma.otpRecord.findFirst({
    where: { email, type, used: false },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return { valid: false, reason: "No OTP found. Please request a new one." };
  if (record.used) return { valid: false, reason: "OTP already used or invalidated." };
  if (record.attempts >= 3) return { valid: false, reason: "OTP has been invalidated due to too many incorrect attempts. Please request a new one." };
  if (new Date() > record.expiresAt) return { valid: false, reason: "OTP has expired. Please request a new one." };

  const submittedHash = hashOtp(email, otp);
  const otpMatches =
    record.otpHash.length === submittedHash.length &&
    crypto.timingSafeEqual(Buffer.from(record.otpHash), Buffer.from(submittedHash));

  if (!otpMatches) {
    const nextAttempts = record.attempts + 1;
    await prisma.otpRecord.update({
      where: { id: record.id },
      data: { attempts: nextAttempts, used: nextAttempts >= 3 },
    });
    if (nextAttempts >= 3) {
      return { valid: false, reason: "Too many incorrect attempts. This OTP has been invalidated. Please request a new one." };
    }
    return { valid: false, reason: `Incorrect OTP. You have ${3 - nextAttempts} attempt(s) remaining.` };
  }

  // Correct — do not mark as used yet (reset-password will consume it)
  return { valid: true };
}

export async function verifyOtpRecord(
  email: string,
  otp: string,
  type: "signup" | "forgot_password"
): Promise<{ valid: boolean; reason?: string }> {
  const record = await prisma.otpRecord.findFirst({
    where: { email, type, used: false },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return { valid: false, reason: "No OTP found. Please request a new one." };
  if (record.used) return { valid: false, reason: "OTP already used or invalidated." };
  if (record.attempts >= 3) return { valid: false, reason: "OTP has been invalidated due to too many incorrect attempts. Please request a new one." };
  if (new Date() > record.expiresAt) return { valid: false, reason: "OTP has expired. Please request a new one." };

  const submittedHash = hashOtp(email, otp);
  const otpMatches =
    record.otpHash.length === submittedHash.length &&
    crypto.timingSafeEqual(Buffer.from(record.otpHash), Buffer.from(submittedHash));

  if (!otpMatches) {
    const nextAttempts = record.attempts + 1;
    await prisma.otpRecord.update({
      where: { id: record.id },
      data: {
        attempts: nextAttempts,
        used: nextAttempts >= 3,
      },
    });

    if (nextAttempts >= 3) {
      return { valid: false, reason: "Too many incorrect attempts. This OTP has been invalidated. Please request a new one." };
    }
    return { valid: false, reason: `Incorrect OTP. You have ${3 - nextAttempts} attempt(s) remaining.` };
  }

  await prisma.otpRecord.update({ where: { id: record.id }, data: { used: true } });

  return { valid: true };
}
