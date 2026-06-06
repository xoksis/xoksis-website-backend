import express from 'express';
import { getCourses, getCourseById, createCourse, updateCourse, deleteCourse, enrollCourse, unenrollCourse } from '../controllers/courseController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
import { enrollmentSubmitLimiter, uploadLimiter } from '../middleware/rateLimitPresets';

const router = express.Router();

router.route('/').get(getCourses).post(protect, admin, uploadLimiter, upload.single('image'), createCourse);
router.route('/:id').get(getCourseById).put(protect, admin, uploadLimiter, upload.single('image'), updateCourse).delete(protect, admin, deleteCourse);
router.post('/:id/enroll', protect, enrollmentSubmitLimiter, enrollCourse);
router.delete('/:id/enroll', protect, unenrollCourse);

export default router;
