import express from 'express';
import { getSiteContent, updateSiteContent } from '../controllers/contentController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
const router = express.Router();
router.get('/:key', getSiteContent);
router.put('/:key', protect, admin, upload.single('image'), updateSiteContent);
export default router;
