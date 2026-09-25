import express from "express";
import { protect, requireEnrollment } from "../middleware/authMiddleware";
import { quizAttemptLimiter, submissionLimiter } from "../middleware/rateLimitPresets";
import { listMyCourses, getMyCourse } from "../controllers/studentController";
import { listMyAssignments, submitAssignment } from "../controllers/assessmentController";
import { listMyQuizzes, startAttempt, getAttempt, saveAttempt, submitAttempt } from "../controllers/quizController";
import { listMyMeetings, joinMeeting } from "../controllers/meetingController";
import {
  getTimeline,
  getCourseProgress,
  completeLesson,
  uncompleteLesson,
  getMyGrades,
  getMyAttendance,
  getMyFees,
  getMyCertificates,
  requestCourseCompletion,
} from "../controllers/progressController";

const router = express.Router();

// ── Courses ──────────────────────────────────────────────────────────────────
router.get("/courses", protect, listMyCourses);
router.get("/courses/:courseId", protect, requireEnrollment, getMyCourse);
router.get("/courses/:courseId/timeline", protect, requireEnrollment, getTimeline);
router.get("/courses/:courseId/progress", protect, requireEnrollment, getCourseProgress);
router.post("/courses/:courseId/complete", protect, requestCourseCompletion);

// ── Course-scoped work ───────────────────────────────────────────────────────
router.get("/courses/:courseId/assignments", protect, requireEnrollment, listMyAssignments);
router.get("/courses/:courseId/quizzes", protect, requireEnrollment, listMyQuizzes);
router.get("/courses/:courseId/meetings", protect, requireEnrollment, listMyMeetings);

// ── Aggregates ───────────────────────────────────────────────────────────────
router.get("/my/grades", protect, getMyGrades);
router.get("/my/attendance", protect, getMyAttendance);
router.get("/my/fees", protect, getMyFees);
router.get("/my/certificates", protect, getMyCertificates);

// ── Ids below are globally unique, so the owning course is resolved inside
//    each controller and membership is checked there.
router.post("/assignments/:assignmentId/submissions", protect, submissionLimiter, submitAssignment);

router.post("/quizzes/:quizId/attempts", protect, quizAttemptLimiter, startAttempt);
router.get("/attempts/:attemptId", protect, quizAttemptLimiter, getAttempt);
router.patch("/attempts/:attemptId", protect, quizAttemptLimiter, saveAttempt);
router.post("/attempts/:attemptId/submit", protect, quizAttemptLimiter, submitAttempt);

router.post("/lessons/:lessonId/complete", protect, completeLesson);
router.delete("/lessons/:lessonId/complete", protect, uncompleteLesson);

// Marks attendance for the signed-in student, then 302s to the meeting link.
router.get("/meetings/:meetingId/join", protect, joinMeeting);

export default router;
