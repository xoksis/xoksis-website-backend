import prisma from "../config/prisma";
const isDev = process.env.NODE_ENV !== "production";
export const getTeamMembers = async (req, res) => {
    try {
        const members = await prisma.teamMember.findMany({
            orderBy: { order: "asc" },
        });
        res.json(members);
    }
    catch (error) {
        console.error("getTeamMembers:", error);
        res
            .status(500)
            .json({ message: "Error fetching team members", ...(isDev && { error: error.message }) });
    }
};
export const createTeamMember = async (req, res) => {
    const { name, role, order } = req.body;
    if (!name || !role) {
        return res.status(400).json({ message: "Name and Role are required." });
    }
    const image = req.file ? req.file.path : "";
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
        console.error("createTeamMember:", error);
        res
            .status(500)
            .json({ message: "Error creating team member", ...(isDev && { error: error.message }) });
    }
};
export const updateTeamMember = async (req, res) => {
    const { name, role, order } = req.body;
    const image = req.file ? req.file.path : req.body.image;
    try {
        const memberId = String(req.params.id);
        const existing = await prisma.teamMember.findUnique({ where: { id: memberId } });
        if (!existing)
            return res.status(404).json({ message: "Team member not found." });
        const finalImage = image ?? existing.image;
        const member = await prisma.teamMember.update({
            where: { id: memberId },
            data: {
                ...(name !== undefined && { name }),
                ...(role !== undefined && { role }),
                image: finalImage,
                ...(order !== undefined && { order: parseInt(order) || 0 }),
            },
        });
        res.json(member);
    }
    catch (error) {
        console.error("updateTeamMember:", error);
        res
            .status(500)
            .json({ message: "Error updating team member", ...(isDev && { error: error.message }) });
    }
};
export const deleteTeamMember = async (req, res) => {
    try {
        const memberId = String(req.params.id);
        const existing = await prisma.teamMember.findUnique({ where: { id: memberId } });
        if (!existing)
            return res.status(404).json({ message: "Team member not found." });
        await prisma.teamMember.delete({ where: { id: memberId } });
        res.json({ message: "Team member deleted" });
    }
    catch (error) {
        console.error("deleteTeamMember:", error);
        res
            .status(500)
            .json({ message: "Error deleting team member", ...(isDev && { error: error.message }) });
    }
};
