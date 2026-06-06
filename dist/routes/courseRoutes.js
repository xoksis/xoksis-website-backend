import express from 'express';
import { getCourses, getCourseById, createCourse, updateCourse, deleteCourse } from '../controllers/courseController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
const router = express.Router();
router.route('/').get(getCourses).post(protect, admin, upload.single('image'), createCourse);
router.route('/:id').get(getCourseById).put(protect, admin, upload.single('image'), updateCourse).delete(protect, admin, deleteCourse);
export default router;
