import express from 'express';
import {
  getStats,
  getAllUsers,
  updateUserRole,
  deleteUser,
  assignCourseTeacher,
  removeCourseTeacher,
  listCourseTeachers,
} from '../controllers/adminController';
import {
  bulkAssignStudents,
  listEnrollments,
  updateEnrollment,
  bulkUpdateFees,
  issueEnrollmentCertificate,
  listPlatformAnnouncements,
  createPlatformAnnouncement,
  updatePlatformAnnouncement,
  deletePlatformAnnouncement,
  listAllAssignments,
  listAllQuizzes,
  getAttendanceReport,
  listAuditLog,
  getLmsSettings,
  updateLmsSettings,
  getLmsAnalytics,
} from '../controllers/lmsAdminController';
import { protect, admin } from '../middleware/authMiddleware';
import { uploadLimiter } from '../middleware/rateLimitPresets';

const router = express.Router();

router.get('/stats', protect, admin, getStats);
router.get('/users', protect, admin, getAllUsers);
router.put('/users/:id/role', protect, admin, updateUserRole);
router.delete('/users/:id', protect, admin, deleteUser);

// LMS: course ↔ teacher assignments
router.get('/courses/:courseId/teachers', protect, admin, listCourseTeachers);
router.post('/courses/:courseId/teachers', protect, admin, assignCourseTeacher);
router.delete('/courses/:courseId/teachers/:teacherId', protect, admin, removeCourseTeacher);

// LMS: enrollments & fees
router.get('/enrollments', protect, admin, listEnrollments);
router.post('/enrollments/bulk-assign', protect, admin, bulkAssignStudents);
router.post('/enrollments/bulk-fee', protect, admin, bulkUpdateFees);
router.patch('/enrollments/:enrollmentId', protect, admin, updateEnrollment);
router.post('/enrollments/:enrollmentId/certificate', protect, admin, issueEnrollmentCertificate);

// LMS: platform-wide announcements
router.get('/announcements', protect, admin, listPlatformAnnouncements);
router.post('/announcements', protect, admin, createPlatformAnnouncement);
router.put('/announcements/:announcementId', protect, admin, updatePlatformAnnouncement);
router.delete('/announcements/:announcementId', protect, admin, deletePlatformAnnouncement);

// LMS: cross-course overviews
router.get('/assignments', protect, admin, listAllAssignments);
router.get('/quizzes', protect, admin, listAllQuizzes);
router.get('/attendance', protect, admin, getAttendanceReport);

// LMS: audit, settings, analytics
router.get('/audit', protect, admin, listAuditLog);
router.get('/lms-settings', protect, admin, getLmsSettings);
router.put('/lms-settings', protect, admin, uploadLimiter, updateLmsSettings);
router.get('/lms-analytics', protect, admin, getLmsAnalytics);

export default router;
