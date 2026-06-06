import express from "express";
import {
  checkEmail,
  registerUser,
  verifySignupOtp,
  resendSignupOtp,
  loginUser,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  setPassword,
  logoutUser,
  getUserProfile,
} from "../controllers/authController";
import { protect } from "../middleware/authMiddleware";
import {
  loginLimiter,
  registerLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
} from "../middleware/rateLimitPresets";

const router = express.Router();

router.post("/check-email",     loginLimiter, checkEmail);
router.post("/register",        registerLimiter, registerUser);
router.post("/verify-otp",      otpVerifyLimiter, verifySignupOtp);
router.post("/resend-otp",      otpRequestLimiter, resendSignupOtp);
router.post("/login",           loginLimiter, loginUser);
router.post("/forgot-password",    otpRequestLimiter, forgotPassword);
router.post("/verify-reset-otp",   otpVerifyLimiter, verifyResetOtp);
router.post("/reset-password",     otpVerifyLimiter, resetPassword);
router.post("/set-password",    otpVerifyLimiter, setPassword);
router.post("/logout",          logoutUser);
router.get("/profile",          protect, getUserProfile);

export default router;
