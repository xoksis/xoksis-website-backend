import express from 'express';
import { getSiteContent, updateSiteContent } from '../controllers/contentController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
import { uploadLimiter } from '../middleware/rateLimitPresets';

const router = express.Router();

router.get('/:key', getSiteContent);
router.put('/:key', protect, admin, uploadLimiter, upload.single('image'), updateSiteContent);

export default router;
