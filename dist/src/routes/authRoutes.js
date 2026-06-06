import express from "express";
import { checkEmail, registerUser, verifySignupOtp, resendSignupOtp, loginUser, forgotPassword, resetPassword, setPassword, getUserProfile, } from "../controllers/authController";
import { protect } from "../middleware/authMiddleware";
import { createRateLimiter } from "../middleware/rateLimiter";
const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: "Too many login attempts. Please try again after 15 minutes."
});
const registerLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: "Too many registration attempts. Please try again after 15 minutes."
});
const otpLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3,
    message: "Too many OTP requests. Please try again after 15 minutes."
});
const router = express.Router();
router.post("/check-email", loginLimiter, checkEmail); // prevent user enumeration
router.post("/register", registerLimiter, registerUser);
router.post("/verify-otp", otpLimiter, verifySignupOtp); // prevent OTP brute-force
router.post("/resend-otp", otpLimiter, resendSignupOtp);
router.post("/login", loginLimiter, loginUser);
router.post("/forgot-password", otpLimiter, forgotPassword);
router.post("/reset-password", otpLimiter, resetPassword); // prevent brute-force
router.post("/set-password", otpLimiter, setPassword); // prevent brute-force
router.get("/profile", protect, getUserProfile);
export default router;
