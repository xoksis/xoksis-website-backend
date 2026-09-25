import express from "express";
import { protect, requireTeacher, teacherOwnsCourse } from "../middleware/authMiddleware";
import { listMyCourses, getCourseWorkspace } from "../controllers/teacherController";
import {
  getCourseContent,
  createModule,
  reorderModules,
  updateModule,
  deleteModule,
  createLesson,
  updateLesson,
  deleteLesson,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "../controllers/lmsContentController";
import {
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getAssignmentSubmissions,
  gradeSubmission,
} from "../controllers/assessmentController";
import {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getQuizResults,
  gradeQuizAttempt,
} from "../controllers/quizController";
import {
  listMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getMeetingAttendance,
  setMeetingAttendance,
} from "../controllers/meetingController";
import { getGradebook, getCourseAnalytics, issueStudentCertificate } from "../controllers/gradebookController";

const router = express.Router();

router.get("/courses", protect, requireTeacher, listMyCourses);
router.get("/courses/:courseId", protect, requireTeacher, teacherOwnsCourse, getCourseWorkspace);

// ── Content authoring ────────────────────────────────────────────────────────
// Everything below is scoped to one course the caller teaches (or any course
// for an admin). Literal segments are declared before parameterised ones.
const course = [protect, requireTeacher, teacherOwnsCourse] as const;

router.get("/courses/:courseId/content", ...course, getCourseContent);

router.post("/courses/:courseId/modules", ...course, createModule);
router.put("/courses/:courseId/modules/reorder", ...course, reorderModules);
router.put("/courses/:courseId/modules/:moduleId", ...course, updateModule);
router.delete("/courses/:courseId/modules/:moduleId", ...course, deleteModule);

router.post("/courses/:courseId/modules/:moduleId/lessons", ...course, createLesson);
router.put("/courses/:courseId/modules/:moduleId/lessons/:lessonId", ...course, updateLesson);
router.delete("/courses/:courseId/modules/:moduleId/lessons/:lessonId", ...course, deleteLesson);

router.post("/courses/:courseId/materials", ...course, createMaterial);
router.put("/courses/:courseId/materials/:materialId", ...course, updateMaterial);
router.delete("/courses/:courseId/materials/:materialId", ...course, deleteMaterial);

router.post("/courses/:courseId/announcements", ...course, createAnnouncement);
router.put("/courses/:courseId/announcements/:announcementId", ...course, updateAnnouncement);
router.delete("/courses/:courseId/announcements/:announcementId", ...course, deleteAnnouncement);

// ── Assessments ──────────────────────────────────────────────────────────────
// Nested static segments must be declared before the bare :assignmentId routes.
router.get(
  "/courses/:courseId/assignments/:assignmentId/submissions",
  ...course,
  getAssignmentSubmissions,
);
router.put(
  "/courses/:courseId/assignments/:assignmentId/submissions/:studentId/grade",
  ...course,
  gradeSubmission,
);

router.get("/courses/:courseId/assignments", ...course, listAssignments);
router.post("/courses/:courseId/assignments", ...course, createAssignment);
router.put("/courses/:courseId/assignments/:assignmentId", ...course, updateAssignment);
router.delete("/courses/:courseId/assignments/:assignmentId", ...course, deleteAssignment);

// ── Quizzes ──────────────────────────────────────────────────────────────────
router.get(
  "/courses/:courseId/quizzes/:quizId/results",
  ...course,
  getQuizResults,
);
router.put(
  "/courses/:courseId/quizzes/:quizId/attempts/:attemptId/grade",
  ...course,
  gradeQuizAttempt,
);

router.post("/courses/:courseId/quizzes/:quizId/questions", ...course, createQuestion);
router.put(
  "/courses/:courseId/quizzes/:quizId/questions/:questionId",
  ...course,
  updateQuestion,
);
router.delete(
  "/courses/:courseId/quizzes/:quizId/questions/:questionId",
  ...course,
  deleteQuestion,
);

router.get("/courses/:courseId/quizzes", ...course, listQuizzes);
router.post("/courses/:courseId/quizzes", ...course, createQuiz);
router.get("/courses/:courseId/quizzes/:quizId", ...course, getQuiz);
router.put("/courses/:courseId/quizzes/:quizId", ...course, updateQuiz);
router.delete("/courses/:courseId/quizzes/:quizId", ...course, deleteQuiz);

// ── Meetings & attendance ────────────────────────────────────────────────────
router.get(
  "/courses/:courseId/meetings/:meetingId/attendance",
  ...course,
  getMeetingAttendance,
);
router.put(
  "/courses/:courseId/meetings/:meetingId/attendance/:studentId",
  ...course,
  setMeetingAttendance,
);

router.get("/courses/:courseId/meetings", ...course, listMeetings);
router.post("/courses/:courseId/meetings", ...course, createMeeting);
router.put("/courses/:courseId/meetings/:meetingId", ...course, updateMeeting);
router.delete("/courses/:courseId/meetings/:meetingId", ...course, deleteMeeting);

// ── Gradebook, analytics & certificates ──────────────────────────────────────
router.get("/courses/:courseId/gradebook", ...course, getGradebook);
router.get("/courses/:courseId/analytics", ...course, getCourseAnalytics);
router.post(
  "/courses/:courseId/students/:studentId/certificate",
  ...course,
  issueStudentCertificate,
);

export default router;
