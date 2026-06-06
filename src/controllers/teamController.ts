import { Request, Response } from "express";
import prisma from "../config/prisma";
import { validateOptionalImageUrl } from "../utils/imageUrl";

const isDev = process.env.NODE_ENV !== "production";

export const getTeamMembers = async (req: Request, res: Response) => {
  try {
    const members = await prisma.teamMember.findMany({
      orderBy: { order: "asc" },
    });
    res.json(members);
  } catch (error: any) {
    console.error("getTeamMembers:", error);
    res
      .status(500)
      .json({ message: "Error fetching team members", ...(isDev && { error: error.message }) });
  }
};

export const createTeamMember = async (req: Request, res: Response) => {
  const { name, role, order } = req.body;
  if (!name || !role) {
    return res.status(400).json({ message: "Name and Role are required." });
  }

  const uploadedImage = req.file ? (req.file as any).path : undefined;
  let image = "";
  if (uploadedImage) {
    image = uploadedImage;
  } else if (req.body.image) {
    const imageResult = validateOptionalImageUrl(req.body.image, "Team member image");
    if (!imageResult.ok) return res.status(400).json({ message: imageResult.error });
    image = imageResult.url ?? "";
  }

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
  } catch (error: any) {
    console.error("createTeamMember:", error);
    res
      .status(500)
      .json({ message: "Error creating team member", ...(isDev && { error: error.message }) });
  }
};

export const updateTeamMember = async (req: Request, res: Response) => {
  const { name, role, order } = req.body;
  const uploadedImage = req.file ? (req.file as any).path : undefined;

  try {
    const memberId = String(req.params.id);
    const existing = await prisma.teamMember.findUnique({ where: { id: memberId } });
    if (!existing) return res.status(404).json({ message: "Team member not found." });

    let finalImage = existing.image;
    if (uploadedImage) {
      finalImage = uploadedImage;
    } else if (req.body.image !== undefined && req.body.image !== "") {
      const imageResult = validateOptionalImageUrl(req.body.image, "Team member image");
      if (!imageResult.ok) return res.status(400).json({ message: imageResult.error });
      if (imageResult.url) finalImage = imageResult.url;
    }

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
  } catch (error: any) {
    console.error("updateTeamMember:", error);
    res
      .status(500)
      .json({ message: "Error updating team member", ...(isDev && { error: error.message }) });
  }
};

export const deleteTeamMember = async (req: Request, res: Response) => {
  try {
    const memberId = String(req.params.id);
    const existing = await prisma.teamMember.findUnique({ where: { id: memberId } });
    if (!existing) return res.status(404).json({ message: "Team member not found." });

    await prisma.teamMember.delete({ where: { id: memberId } });
    res.json({ message: "Team member deleted" });
  } catch (error: any) {
    console.error("deleteTeamMember:", error);
    res
      .status(500)
      .json({ message: "Error deleting team member", ...(isDev && { error: error.message }) });
  }
};
