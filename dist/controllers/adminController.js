import prisma from '../config/prisma';
export const getAllUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                avatar: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(users);
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching users', error: error.message });
    }
};
export const updateUserRole = async (req, res) => {
    const { role } = req.body;
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { role },
            select: { id: true, email: true, role: true }
        });
        res.json(user);
    }
    catch (error) {
        res.status(500).json({ message: 'Error updating user role', error: error.message });
    }
};
export const deleteUser = async (req, res) => {
    const userId = req.params.id;
    try {
        // Manually delete related records to avoid foreign key constraints
        await prisma.$transaction([
            prisma.enrollment.deleteMany({ where: { userId } }),
            prisma.subscription.deleteMany({ where: { userId } }),
            prisma.certificate.deleteMany({ where: { userId } }),
            prisma.notification.deleteMany({ where: { userId } }),
            prisma.feedback.deleteMany({ where: { userId } }),
            prisma.blogPost.deleteMany({ where: { authorId: userId } }),
            prisma.user.delete({ where: { id: userId } }),
        ]);
        res.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ message: 'Error deleting user', error: error.message });
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
        res.json({
            users: userCount,
            courses: courseCount,
            products: productCount,
            blogs: blogCount,
        });
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching stats', error: error.message });
    }
};
