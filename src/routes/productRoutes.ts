import express from 'express';
import { getProducts, getProductBySlug, createProduct, updateProduct, deleteProduct } from '../controllers/productController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
import { uploadLimiter } from '../middleware/rateLimitPresets';

const router = express.Router();

const productUpload = upload.fields([
  { name: 'coverImage', maxCount: 1 },
  { name: 'screenshotFiles', maxCount: 10 },
]);

router.route('/').get(getProducts).post(protect, admin, uploadLimiter, productUpload, createProduct);
router.route('/:slug').get(getProductBySlug);
router.route('/:id').put(protect, admin, uploadLimiter, productUpload, updateProduct).delete(protect, admin, deleteProduct);

export default router;
