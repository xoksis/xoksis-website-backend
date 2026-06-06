import express from 'express';
import { getServices, getServiceBySlug, createService, updateService, deleteService } from '../controllers/serviceController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
import { uploadLimiter } from '../middleware/rateLimitPresets';

const router = express.Router();

router.route('/').get(getServices).post(protect, admin, uploadLimiter, upload.single('image'), createService);
router.route('/:id').put(protect, admin, uploadLimiter, upload.single('image'), updateService).delete(protect, admin, deleteService);
router.route('/slug/:slug').get(getServiceBySlug);

export default router;
