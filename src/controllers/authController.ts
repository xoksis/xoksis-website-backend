import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma";
import { createOtpRecord, verifyOtpRecord, peekOtpRecord } from "../utils/otp";
import {
  sendSignupOtp,
  sendWelcomeEmail,
  sendForgotPasswordOtp,
} from "../services/emailService";
import { generateUniqueReferralCode } from "../services/referralService";
import { authUserResponse, clearAuthCookie, setAuthCookie } from "../utils/authToken";
import { clearUserCache } from "../middleware/authMiddleware";

const isDev = process.env.NODE_ENV !== "production";

// POST /api/auth/check-email — uniform response to prevent user enumeration
export const checkEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required." });
    // Always return the same shape regardless of whether the account exists
    res.json({ continue: true });
  } catch (error: any) {
    console.error("checkEmail:", error);
    res.status(500).json({ message: "Failed to check email.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/register
export const registerUser = async (req: Request, res: Response) => {
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
  } catch (error: any) {
    console.error("registerUser:", error);
    res.status(500).json({ message: "Registration failed.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/verify-otp
export const verifySignupOtp = async (req: Request, res: Response) => {
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

    sendWelcomeEmail(email, user.name || user.firstName || "there");

    setAuthCookie(res, user.id, user.tokenVersion);
    res.json(authUserResponse(user));
  } catch (error: any) {
    console.error("verifySignupOtp:", error);
    res.status(500).json({ message: "OTP verification failed.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/resend-otp
export const resendSignupOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      const otp = await createOtpRecord(email, "signup");
      await sendSignupOtp(email, user.name || user.firstName || "there", otp);
    }

    res.json({ message: "If an account exists for this email, an OTP has been sent." });
  } catch (error: any) {
    console.error("resendSignupOtp:", error);
    res.status(500).json({ message: "Failed to resend OTP.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/login
export const loginUser = async (req: Request, res: Response) => {
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

    setAuthCookie(res, user.id, user.tokenVersion);
    res.json(authUserResponse(user));
  } catch (error: any) {
    console.error("loginUser:", error);
    res.status(500).json({ message: "Login failed.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/logout
export const logoutUser = (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ message: "Logged out successfully." });
};

// POST /api/auth/forgot-password
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json({ message: "If that email exists, an OTP has been sent." });
    }

    const otp = await createOtpRecord(email, "forgot_password");
    await sendForgotPasswordOtp(email, user.name || user.firstName || "there", otp);

    res.json({ message: "If that email exists, an OTP has been sent." });
  } catch (error: any) {
    console.error("forgotPassword:", error);
    res.status(500).json({ message: "Failed to process request.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/verify-reset-otp  (check OTP is correct without consuming it)
export const verifyResetOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required." });

    const result = await peekOtpRecord(email, otp, "forgot_password");
    if (!result.valid) return res.status(400).json({ message: result.reason });

    res.json({ message: "OTP verified." });
  } catch (error: any) {
    console.error("verifyResetOtp:", error);
    res.status(500).json({ message: "Verification failed.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/reset-password
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const result = await verifyOtpRecord(email, otp, "forgot_password");
    if (!result.valid) {
      return res.status(400).json({ message: result.reason });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const user = await prisma.user.update({
      where: { email },
      data: { password: hashed, tokenVersion: { increment: 1 } },
    });

    clearUserCache(user.id);
    clearAuthCookie(res);

    res.json({ message: "Password reset successfully. You can now log in." });
  } catch (error: any) {
    console.error("resetPassword:", error);
    res.status(500).json({ message: "Password reset failed.", ...(isDev && { error: error.message }) });
  }
};

// POST /api/auth/set-password (Google users setting a manual password)
export const setPassword = async (req: Request, res: Response) => {
  try {
    const { email, otp, password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const result = await verifyOtpRecord(email, otp, "forgot_password");
    if (!result.valid) return res.status(400).json({ message: result.reason });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({
      where: { email },
      data: { password: hashed, authProvider: "both", tokenVersion: { increment: 1 } },
    });

    clearUserCache(user.id);
    setAuthCookie(res, user.id, user.tokenVersion);
    res.json(authUserResponse(user));
  } catch (error: any) {
    console.error("setPassword:", error);
    res.status(500).json({ message: "Failed to set password.", ...(isDev && { error: error.message }) });
  }
};

// GET /api/auth/profile
export const getUserProfile = async (req: any, res: Response) => {
  try {
    let [user, activeReferralsCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          enrollments:   { take: 20, orderBy: { createdAt: "desc" } },
          subscriptions: { take: 10, orderBy: { startDate: "desc" } },
          certificates:  { take: 20, orderBy: { issuedAt: "desc" } },
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

    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.referralCode) {
      const code = await generateUniqueReferralCode();
      user = await prisma.user.update({
        where: { id: req.user.id },
        data: { referralCode: code },
        include: {
          enrollments:   { take: 20, orderBy: { createdAt: "desc" } },
          subscriptions: { take: 10, orderBy: { startDate: "desc" } },
          certificates:  { take: 20, orderBy: { issuedAt: "desc" } },
          notifications: { where: { read: false }, take: 20, orderBy: { createdAt: "desc" } },
        },
      });
    }

    const referralDiscount = activeReferralsCount * 500;
    const { password, tokenVersion, ...userWithoutPassword } = user as any;
    res.json({ ...userWithoutPassword, activeReferralsCount, referralDiscount });
  } catch (error: any) {
    console.error("getUserProfile:", error);
    res.status(500).json({ message: "Failed to load profile.", ...(isDev && { error: error.message }) });
  }
};
