import { Request, Response } from "express";
import prisma from "../config/prisma";
import { validateOptionalImageUrl } from "../utils/imageUrl";

const isDev = process.env.NODE_ENV !== "production";

export const getSiteContent = async (req: Request, res: Response) => {
  const key = String(req.params.key);
  try {
    const content = await prisma.siteContent.findUnique({ where: { key } });
    if (content) {
      res.json(content.content);
    } else {
      res.status(404).json({ message: "Content not found" });
    }
  } catch (error: any) {
    console.error("getSiteContent:", error);
    res
      .status(500)
      .json({ message: "Error fetching site content", ...(isDev && { error: error.message }) });
  }
};

export const updateSiteContent = async (req: Request, res: Response) => {
  const key = String(req.params.key);
  let { content } = req.body;

  try {
    // If sent via FormData, content might be a stringified JSON
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        return res.status(400).json({ message: "content must be a valid JSON string." });
      }
    }

    // If an image was uploaded, update the image field in content
    if (req.file) {
      content.image = (req.file as any).path;
    } else if (content?.image) {
      const imageResult = validateOptionalImageUrl(content.image, "Content image");
      if (!imageResult.ok) return res.status(400).json({ message: imageResult.error });
      if (imageResult.url) content.image = imageResult.url;
    }

    const updatedContent = await prisma.siteContent.upsert({
      where: { key },
      update: { content },
      create: { key, content },
    });
    res.json(updatedContent.content);
  } catch (error: any) {
    console.error("updateSiteContent:", error);
    res
      .status(500)
      .json({ message: "Error updating site content", ...(isDev && { error: error.message }) });
  }
};
