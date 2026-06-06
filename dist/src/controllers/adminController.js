import prisma from "../config/prisma";
import { clearUserCache } from "../middleware/authMiddleware";
const isDev = process.env.NODE_ENV !== "production";
export const getAllUsers = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || "1")));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"))));
        const skip = (page - 1) * limit;
        const [users, totalCount] = await Promise.all([
            prisma.user.findMany({
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                    createdAt: true,
                    avatar: true,
                },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            }),
            prisma.user.count(),
        ]);
        res.json({
            users,
            totalCount,
            page,
            limit,
            hasMore: skip + users.length < totalCount,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ message: "Error fetching users", error: error.message });
    }
};
export const updateUserRole = async (req, res) => {
    const { role } = req.body;
    const userId = String(req.params.id);
    const ALLOWED_ROLES = ["USER", "ADMIN", "MENTOR"];
    if (!role || !ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ message: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(", ")}.` });
    }
    try {
        const user = await prisma.user.update({
            where: { id: userId },
            data: { role },
            select: { id: true, email: true, role: true },
        });
        // Invalidate cached user so role change takes effect immediately
        clearUserCache(userId);
        res.json(user);
    }
    catch (error) {
        res.status(500).json({ message: "Error updating user role", ...(isDev && { error: error.message }) });
    }
};
export const deleteUser = async (req, res) => {
    const userId = String(req.params.id);
    try {
        await prisma.$transaction([
            prisma.enrollment.deleteMany({ where: { userId } }),
            prisma.subscription.deleteMany({ where: { userId } }),
            prisma.certificate.deleteMany({ where: { userId } }),
            prisma.notification.deleteMany({ where: { userId } }),
            prisma.feedback.deleteMany({ where: { userId } }),
            prisma.blogPost.deleteMany({ where: { authorId: userId } }),
            prisma.user.delete({ where: { id: userId } }),
        ]);
        // Invalidate cache immediately after deletion
        clearUserCache(userId);
        res.json({ message: "User deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting user", ...(isDev && { error: error.message }) });
    }
};
export const getStats = async (req, res) => {
    try {
        const [userCount, courseCount, productCount, blogCount] = await Promise.all([
            prisma.user.count(),
            prisma.course.count(),
            prisma.product.count(),
            prisma.blogPost.count(),
        ]);
        res.json({ users: userCount, courses: courseCount, products: productCount, blogs: blogCount });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching stats", ...(isDev && { error: error.message }) });
    }
};
