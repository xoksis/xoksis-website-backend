import { Response } from "express";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/authMiddleware";
import { fail, serverError } from "../utils/lmsHttp";

// GET /api/notifications?unreadOnly=true&limit=50
export const listNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const unreadOnly = req.query.unreadOnly === "true";
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.id, ...(unreadOnly && { read: false }) },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, title: true, message: true, read: true, createdAt: true },
      }),
      prisma.notification.count({ where: { userId: req.user!.id, read: false } }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    serverError(res, "listNotifications", "Failed to load notifications", error);
  }
};

// PUT /api/notifications/:notificationId/read
export const markNotificationRead = async (req: AuthRequest, res: Response) => {
  try {
    const notificationId = String(req.params.notificationId);
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, userId: req.user!.id },
      data: { read: true },
    });
    if (result.count === 0) return fail(res, 404, "Notification not found");
    res.json({ id: notificationId, read: true });
  } catch (error) {
    serverError(res, "markNotificationRead", "Failed to update the notification", error);
  }
};

// POST /api/notifications/read-all
export const markAllNotificationsRead = async (req: AuthRequest, res: Response) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data: { read: true },
    });
    res.json({ updated: result.count });
  } catch (error) {
    serverError(res, "markAllNotificationsRead", "Failed to update notifications", error);
  }
};
