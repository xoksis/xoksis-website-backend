import prisma from '../config/prisma';
export const getTeamMembers = async (req, res) => {
    try {
        const members = await prisma.teamMember.findMany({
            orderBy: { order: 'asc' },
        });
        res.json(members);
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching team members', error: error.message });
    }
};
export const createTeamMember = async (req, res) => {
    const { name, role, order } = req.body;
    const image = req.file ? req.file.path : '';
    try {
        const member = await prisma.teamMember.create({
            data: {
                name,
                role,
                image,
                order: parseInt(order) || 0,
            },
        });
        res.status(201).json(member);
    }
    catch (error) {
        res.status(500).json({ message: 'Error creating team member', error: error.message });
    }
};
export const updateTeamMember = async (req, res) => {
    const { name, role, order } = req.body;
    const image = req.file ? req.file.path : req.body.image;
    try {
        const member = await prisma.teamMember.update({
            where: { id: req.params.id },
            data: {
                name,
                role,
                image,
                order: parseInt(order) || 0,
            },
        });
        res.json(member);
    }
    catch (error) {
        res.status(500).json({ message: 'Error updating team member', error: error.message });
    }
};
export const deleteTeamMember = async (req, res) => {
    try {
        await prisma.teamMember.delete({ where: { id: req.params.id } });
        res.json({ message: 'Team member deleted' });
    }
    catch (error) {
        res.status(500).json({ message: 'Error deleting team member', error: error.message });
    }
};
