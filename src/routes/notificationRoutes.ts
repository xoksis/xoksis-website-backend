import express from "express";
import { protect } from "../middleware/authMiddleware";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notificationController";

const router = express.Router();

router.get("/", protect, listNotifications);
router.post("/read-all", protect, markAllNotificationsRead);
router.put("/:notificationId/read", protect, markNotificationRead);

export default router;
