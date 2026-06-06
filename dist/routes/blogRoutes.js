import express from 'express';
import { getBlogPosts, getBlogPostBySlug, createBlogPost, deleteBlogPost } from '../controllers/blogController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
const router = express.Router();
router.route('/').get(getBlogPosts).post(protect, admin, upload.single('coverImage'), createBlogPost);
router.route('/:slug').get(getBlogPostBySlug);
router.route('/:id').delete(protect, admin, deleteBlogPost);
export default router;
