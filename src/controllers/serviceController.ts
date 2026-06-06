import type { Request, Response } from "express";
import prisma from "../config/prisma";
import { generateUniqueSlug } from "../utils/slug";
import { resolveImageField, validateOptionalImageUrl } from "../utils/imageUrl";

const isDev = process.env.NODE_ENV !== "production";

function safeParseJson(value: any, defaultValue: any = []): any {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

export const getServices = async (req: Request, res: Response) => {
  try {
    const services = await prisma.service.findMany();
    res.json(services);
  } catch (error: any) {
    console.error("getServices:", error);
    res.status(500).json({ message: "Failed to retrieve services", ...(isDev && { error: error.message }) });
  }
};

export const getServiceBySlug = async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const service = await prisma.service.findUnique({ where: { slug } });
    if (service) {
      res.json(service);
    } else {
      res.status(404).json({ message: "Service not found" });
    }
  } catch (error: any) {
    console.error("getServiceBySlug:", error);
    res.status(500).json({ message: "Failed to retrieve service", ...(isDev && { error: error.message }) });
  }
};

export const createService = async (req: Request, res: Response) => {
  try {
    const {
      slug,
      title,
      shortTitle,
      shortDescription,
      longDescription,
      accent,
      icon,
      highlights,
      process,
      technologies,
      team,
    } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title is required." });
    }

    const uploadedImage = req.file ? (req.file as any).path : undefined;
    let image = "";
    if (uploadedImage) {
      image = uploadedImage;
    } else if (req.body.image) {
      const imageResult = validateOptionalImageUrl(req.body.image, "Service image");
      if (!imageResult.ok) return res.status(400).json({ message: imageResult.error });
      image = imageResult.url ?? "";
    }
    const finalSlug = await generateUniqueSlug(slug || title, "service");

    const service = await prisma.service.create({
      data: {
        slug: finalSlug,
        title,
        shortTitle: shortTitle || "",
        shortDescription: shortDescription || "",
        longDescription: longDescription || "",
        image: image || "",
        accent: accent || "",
        icon: icon || "",
        highlights: safeParseJson(highlights),
        process: safeParseJson(process),
        technologies: safeParseJson(technologies),
        team: safeParseJson(team),
      },
    });

    res.status(201).json(service);
  } catch (error: any) {
    console.error("createService:", error);
    res.status(500).json({ message: "Failed to create service", ...(isDev && { error: error.message }) });
  }
};

export const updateService = async (req: Request, res: Response) => {
  const {
    slug,
    title,
    shortTitle,
    shortDescription,
    longDescription,
    accent,
    icon,
    highlights,
    process,
    technologies,
    team,
  } = req.body;
  const uploadedImage = req.file ? (req.file as any).path : undefined;

  try {
    const serviceId = String(req.params.id);
    const existing = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!existing) return res.status(404).json({ message: "Service not found." });

    let finalImage = existing.image;
    if (uploadedImage) {
      finalImage = uploadedImage;
    } else if (req.body.image !== undefined && req.body.image !== "") {
      const imageResult = resolveImageField(undefined, req.body.image, "Service image", { required: true });
      if (!imageResult.ok) return res.status(400).json({ message: imageResult.error });
      finalImage = imageResult.url;
    }
    let finalSlug = existing.slug;
    if (slug !== undefined) {
      finalSlug = await generateUniqueSlug(slug || title || existing.title, "service", serviceId);
    }

    const service = await prisma.service.update({
      where: { id: serviceId },
      data: {
        slug: finalSlug,
        ...(title !== undefined && { title }),
        ...(shortTitle !== undefined && { shortTitle }),
        ...(shortDescription !== undefined && { shortDescription }),
        ...(longDescription !== undefined && { longDescription }),
        image: finalImage,
        ...(accent !== undefined && { accent }),
        ...(icon !== undefined && { icon }),
        ...(highlights !== undefined && { highlights: safeParseJson(highlights) }),
        ...(process !== undefined && { process: safeParseJson(process) }),
        ...(technologies !== undefined && { technologies: safeParseJson(technologies) }),
        ...(team !== undefined && { team: safeParseJson(team) }),
      },
    });
    res.json(service);
  } catch (error: any) {
    console.error("updateService:", error);
    res.status(500).json({ message: "Error updating service", ...(isDev && { error: error.message }) });
  }
};

export const deleteService = async (req: Request, res: Response) => {
  try {
    const serviceId = String(req.params.id);
    const existing = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!existing) return res.status(404).json({ message: "Service not found." });

    await prisma.service.delete({ where: { id: serviceId } });
    res.json({ message: "Service deleted successfully" });
  } catch (error: any) {
    console.error("deleteService:", error);
    res.status(500).json({ message: "Error deleting service", ...(isDev && { error: error.message }) });
  }
};
