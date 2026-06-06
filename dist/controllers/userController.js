import prisma from '../config/prisma';
export const completeOnboarding = async (req, res) => {
    const { interests, skillLevel, goal, userType } = req.body;
    const user = await prisma.user.update({
        where: { id: req.user.id },
        data: {
            interests,
            skillLevel,
            goal,
            userType,
            onboardingDone: true,
        },
    });
    res.json(user);
};
export const updateAvatar = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    const user = await prisma.user.update({
        where: { id: req.user.id },
        data: {
            avatar: req.file.path
        }
    });
    res.json(user);
};
