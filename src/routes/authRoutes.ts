import express from "express";
import {
  checkEmail,
  registerUser,
  verifySignupOtp,
  resendSignupOtp,
  loginUser,
  googleAuth,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  setPassword,
  logoutUser,
  getUserProfile,
} from "../controllers/authController";
import { protect } from "../middleware/authMiddleware";
import { requireFields } from "../middleware/validateBody";
import {
  loginLimiter,
  registerLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
} from "../middleware/rateLimitPresets";

const router = express.Router();

// Rate limiter first so malformed-request floods are throttled too, then field
// validation so a missing field returns 400 instead of reaching Prisma.
router.post("/check-email",     loginLimiter, requireFields("email"), checkEmail);
router.post("/register",        registerLimiter, requireFields("email", "password"), registerUser);
router.post("/verify-otp",      otpVerifyLimiter, requireFields("email", "otp"), verifySignupOtp);
router.post("/resend-otp",      otpRequestLimiter, requireFields("email"), resendSignupOtp);
router.post("/login",           loginLimiter, requireFields("email", "password"), loginUser);
router.post("/google",          loginLimiter, requireFields("credential"), googleAuth);
router.post("/forgot-password",    otpRequestLimiter, requireFields("email"), forgotPassword);
router.post("/verify-reset-otp",   otpVerifyLimiter, requireFields("email", "otp"), verifyResetOtp);
router.post("/reset-password",     otpVerifyLimiter, requireFields("email", "otp", "newPassword"), resetPassword);
router.post("/set-password",    otpVerifyLimiter, requireFields("email", "otp", "password"), setPassword);
router.post("/logout",          logoutUser);
router.get("/profile",          protect, getUserProfile);

export default router;
