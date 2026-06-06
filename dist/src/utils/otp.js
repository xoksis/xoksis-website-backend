import crypto from "crypto";
import prisma from "../config/prisma";
const OTP_TTL_MINUTES = 10;
export function generateOtp() {
    return String(crypto.randomInt(100000, 999999));
}
export async function createOtpRecord(email, type) {
    // Invalidate any existing unused OTPs of same type for this email
    await prisma.otpRecord.updateMany({
        where: { email, type, used: false },
        data: { used: true },
    });
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await prisma.otpRecord.create({ data: { email, otp, type, expiresAt } });
    return otp;
}
export async function verifyOtpRecord(email, otp, type) {
    const record = await prisma.otpRecord.findFirst({
        where: { email, type, used: false },
        orderBy: { createdAt: "desc" },
    });
    if (!record)
        return { valid: false, reason: "No OTP found. Please request a new one." };
    if (record.used)
        return { valid: false, reason: "OTP already used or invalidated." };
    if (record.attempts >= 3)
        return { valid: false, reason: "OTP has been invalidated due to too many incorrect attempts. Please request a new one." };
    if (new Date() > record.expiresAt)
        return { valid: false, reason: "OTP has expired. Please request a new one." };
    // Bug #15 fix: constant-time comparison prevents timing side-channel attacks
    const otpMatches = record.otp.length === otp.length &&
        crypto.timingSafeEqual(Buffer.from(record.otp), Buffer.from(otp));
    if (!otpMatches) {
        const nextAttempts = record.attempts + 1;
        await prisma.otpRecord.update({
            where: { id: record.id },
            data: {
                attempts: nextAttempts,
                used: nextAttempts >= 3 ? true : false
            }
        });
        if (nextAttempts >= 3) {
            return { valid: false, reason: "Too many incorrect attempts. This OTP has been invalidated. Please request a new one." };
        }
        return { valid: false, reason: `Incorrect OTP. You have ${3 - nextAttempts} attempt(s) remaining.` };
    }
    await prisma.otpRecord.update({ where: { id: record.id }, data: { used: true } });
    return { valid: true };
}
