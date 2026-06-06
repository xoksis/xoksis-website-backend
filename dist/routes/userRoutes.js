import express from 'express';
import { completeOnboarding, updateAvatar } from '../controllers/userController';
import { protect } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
const router = express.Router();
router.post('/onboarding', protect, completeOnboarding);
router.post('/avatar', protect, upload.single('avatar'), updateAvatar);
export default router;
