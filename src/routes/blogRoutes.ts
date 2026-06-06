import express from 'express';
import { getBlogPosts, getBlogPostBySlug, createBlogPost, updateBlogPost, deleteBlogPost } from '../controllers/blogController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
import { uploadLimiter } from '../middleware/rateLimitPresets';

const router = express.Router();

// Public — list (paginated) and single by slug
router.get('/',         getBlogPosts);
router.get('/:slug',    getBlogPostBySlug);

// Admin — create / update / delete
// Use /by-id/:id prefix to avoid route collision with /:slug
router.post('/',              protect, admin, uploadLimiter, upload.single('coverImage'), createBlogPost);
router.put('/by-id/:id',      protect, admin, uploadLimiter, upload.single('coverImage'), updateBlogPost);
router.delete('/by-id/:id',   protect, admin, deleteBlogPost);

export default router;
