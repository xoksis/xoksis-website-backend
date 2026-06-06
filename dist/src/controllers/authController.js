import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import { createOtpRecord, verifyOtpRecord } from "../utils/otp";
import { sendSignupOtp, sendWelcomeEmail, sendForgotPasswordOtp, } from "../services/emailService";
import { generateUniqueReferralCode } from "../services/referralService";
const isDev = process.env.NODE_ENV !== "production";
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
// POST /api/auth/check-email
export const checkEmail = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email)
            return res.status(400).json({ message: "Email required." });
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user)
            return res.json({ exists: false });
        res.json({ exists: true, provider: user.authProvider, name: user.name || user.firstName });
    }
    catch (error) {
        console.error("checkEmail:", error);
        res.status(500).json({ message: "Failed to check email.", ...(isDev && { error: error.message }) });
    }
};
// POST /api/auth/register
export const registerUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required." });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters." });
        }
        const userExists = await prisma.user.findUnique({ where: { email } });
        if (userExists) {
            return res.status(400).json({ message: "An account with this email already exists." });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const referralCode = await generateUniqueReferralCode();
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                emailVerified: false,
                authProvider: "manual",
                referralCode,
            },
        });
        const otp = await createOtpRecord(email, "signup");
        await sendSignupOtp(email, "there", otp);
        res.status(201).json({
            message: "Account created. Please verify your email with the OTP sent.",
            email: user.email,
        });
    }
    catch (error) {
        console.error("registerUser:", error);
        res.status(500).json({ message: "Registration failed.", ...(isDev && { error: error.message }) });
    }
};
// POST /api/auth/verify-otp
export const verifySignupOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const result = await verifyOtpRecord(email, otp, "signup");
        if (!result.valid) {
            return res.status(400).json({ message: result.reason });
        }
        const user = await prisma.user.update({
            where: { email },
            data: { emailVerified: true },
        });
        // Fire-and-forget welcome email
        sendWelcomeEmail(email, user.name || user.firstName || "there");
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            onboardingDone: user.onboardingDone,
            token: generateToken(user.id),
        });
    }
    catch (error) {
        console.error("verifySignupOtp:", error);
        res.status(500).json({ message: "OTP verification failed.", ...(isDev && { error: error.message }) });
    }
};
// POST /api/auth/resend-otp
export const resendSignupOtp = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user)
            return res.status(404).json({ message: "No account with that email." });
        if (user.emailVerified)
            return res.status(400).json({ message: "Email already verified." });
        const otp = await createOtpRecord(email, "signup");
        await sendSignupOtp(email, user.name || user.firstName || "there", otp);
        res.json({ message: "OTP resent." });
    }
    catch (error) {
        console.error("resendSignupOtp:", error);
        res.status(500).json({ message: "Failed to resend OTP.", ...(isDev && { error: error.message }) });
    }
};
// POST /api/auth/login
export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "Invalid email or password" });
        }
        if (!user.emailVerified) {
            const otp = await createOtpRecord(email, "signup");
            await sendSignupOtp(email, user.name || user.firstName || "there", otp);
            return res.status(403).json({
                message: "Email not verified. A new OTP has been sent to your email.",
                requiresVerification: true,
                email,
            });
        }
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            onboardingDone: user.onboardingDone,
            token: generateToken(user.id),
        });
    }
    catch (error) {
        console.error("loginUser:", error);
        res.status(500).json({ message: "Login failed.", ...(isDev && { error: error.message }) });
    }
};
// POST /api/auth/forgot-password
export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        // Always respond with success to prevent email enumeration
        if (!user) {
            return res.json({ message: "If that email exists, an OTP has been sent." });
        }
        const otp = await createOtpRecord(email, "forgot_password");
        await sendForgotPasswordOtp(email, user.name || user.firstName || "there", otp);
        res.json({ message: "If that email exists, an OTP has been sent." });
    }
    catch (error) {
        console.error("forgotPassword:", error);
        res.status(500).json({ message: "Failed to process request.", ...(isDev && { error: error.message }) });
    }
};
// POST /api/auth/reset-password
export const resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        // Aligned to 8 chars minimum (same as register & changePassword)
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters." });
        }
        const result = await verifyOtpRecord(email, otp, "forgot_password");
        if (!result.valid) {
            return res.status(400).json({ message: result.reason });
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({ where: { email }, data: { password: hashed } });
        res.json({ message: "Password reset successfully. You can now log in." });
    }
    catch (error) {
        console.error("resetPassword:", error);
        res.status(500).json({ message: "Password reset failed.", ...(isDev && { error: error.message }) });
    }
};
// POST /api/auth/set-password (Google users setting a manual password)
export const setPassword = async (req, res) => {
    try {
        const { email, otp, password } = req.body;
        // Aligned to 8 chars minimum
        if (!password || password.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters." });
        }
        const result = await verifyOtpRecord(email, otp, "forgot_password");
        if (!result.valid)
            return res.status(400).json({ message: result.reason });
        const hashed = await bcrypt.hash(password, 10);
        const user = await prisma.user.update({
            where: { email },
            data: { password: hashed, authProvider: "both" },
        });
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            onboardingDone: user.onboardingDone,
            token: generateToken(user.id),
        });
    }
    catch (error) {
        console.error("setPassword:", error);
        res.status(500).json({ message: "Failed to set password.", ...(isDev && { error: error.message }) });
    }
};
// GET /api/auth/profile
export const getUserProfile = async (req, res) => {
    try {
        let [user, activeReferralsCount] = await Promise.all([
            prisma.user.findUnique({
                where: { id: req.user.id },
                include: {
                    enrollments: { take: 20, orderBy: { createdAt: "desc" } },
                    subscriptions: { take: 10, orderBy: { startDate: "desc" } },
                    certificates: { take: 20, orderBy: { issuedAt: "desc" } },
                    notifications: { where: { read: false }, take: 20, orderBy: { createdAt: "desc" } },
                },
            }),
            prisma.enrollment.count({
                where: {
                    referrerId: req.user.id,
                    feeTier: "standard",
                    applicationStatus: "APPROVED",
                    accessStatus: "active",
                },
            }),
        ]);
        if (!user)
            return res.status(404).json({ message: "User not found" });
        // Self-healing: generate referral code if missing
        if (!user.referralCode) {
            const code = await generateUniqueReferralCode();
            user = await prisma.user.update({
                where: { id: req.user.id },
                data: { referralCode: code },
                include: {
                    enrollments: { take: 20, orderBy: { createdAt: "desc" } },
                    subscriptions: { take: 10, orderBy: { startDate: "desc" } },
                    certificates: { take: 20, orderBy: { issuedAt: "desc" } },
                    notifications: { where: { read: false }, take: 20, orderBy: { createdAt: "desc" } },
                },
            });
        }
        const referralDiscount = activeReferralsCount * 500;
        const { password, ...userWithoutPassword } = user;
        res.json({ ...userWithoutPassword, activeReferralsCount, referralDiscount });
    }
    catch (error) {
        console.error("getUserProfile:", error);
        res.status(500).json({ message: "Failed to load profile.", ...(isDev && { error: error.message }) });
    }
};
