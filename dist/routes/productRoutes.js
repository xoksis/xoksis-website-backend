import express from 'express';
import { getProducts, getProductBySlug, createProduct, updateProduct, deleteProduct } from '../controllers/productController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
const router = express.Router();
router.route('/').get(getProducts).post(protect, admin, upload.single('coverImage'), createProduct);
router.route('/:slug').get(getProductBySlug);
router.route('/:id').put(protect, admin, upload.single('coverImage'), updateProduct).delete(protect, admin, deleteProduct);
export default router;
