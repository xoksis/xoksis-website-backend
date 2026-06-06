import express from "express";
import { submitEnrollment, getEnrollments, getMyEnrollments, updateEnrollment, deleteEnrollment, createEnrollmentManually, getEnrollmentEmailTemplates, createEnrollmentEmailTemplate, updateEnrollmentEmailTemplate, previewEnrollmentEmail, sendEnrollmentEmail, getEnrollmentEmailCampaigns, } from "../controllers/enrollmentController";
import { protect, admin } from "../middleware/authMiddleware";
const router = express.Router();
// Non-parameterized routes first
router.get("/mine", protect, getMyEnrollments); // current user's own enrollments
router.get("/", protect, admin, getEnrollments);
router.post("/", protect, submitEnrollment);
router.post("/manual", protect, admin, createEnrollmentManually);
router.get("/email/templates", protect, admin, getEnrollmentEmailTemplates);
router.post("/email/templates", protect, admin, createEnrollmentEmailTemplate);
router.put("/email/templates/:id", protect, admin, updateEnrollmentEmailTemplate);
router.post("/email/preview", protect, admin, previewEnrollmentEmail);
router.post("/email/send", protect, admin, sendEnrollmentEmail);
router.get("/email/campaigns", protect, admin, getEnrollmentEmailCampaigns);
// Parameterized routes after
router.put("/:id", protect, admin, updateEnrollment);
router.delete("/:id", protect, admin, deleteEnrollment);
export default router;
