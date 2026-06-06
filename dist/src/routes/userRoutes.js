import express from 'express';
import { completeOnboarding, updateAvatar, updateProfile, changePassword } from '../controllers/userController';
import { protect } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
const router = express.Router();
router.post('/onboarding', protect, completeOnboarding);
router.post('/avatar', protect, upload.single('avatar'), updateAvatar);
router.put('/profile', protect, updateProfile); // phone, language
router.put('/password', protect, changePassword); // change password (requires current)
export default router;
