import type { Request, Response } from "express";
import prisma from "../config/prisma";
import { generateUniqueSlug } from "../utils/slug";
import { resolveImageField, validateImageUrlList } from "../utils/imageUrl";

const isDev = process.env.NODE_ENV !== "production";

function safeParseArray(value: any, fieldName: string): { ok: true; data: string[] } | { ok: false; error: string } {
  if (Array.isArray(value)) return { ok: true, data: value };
  if (value === undefined || value === null || value === "") return { ok: true, data: [] };
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return { ok: false, error: `${fieldName} must be a JSON array.` };
      return { ok: true, data: parsed };
    } catch {
      return { ok: false, error: `${fieldName} must be valid JSON.` };
    }
  }
  return { ok: false, error: `${fieldName} must be a JSON array or string.` };
}

// GET /api/products?page=1&limit=20
export const getProducts = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const skip  = (page - 1) * limit;

    const [products, total] = await Promise.all([
      prisma.product.findMany({ skip, take: limit }),
      prisma.product.count(),
    ]);

    res.json({ data: products, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    console.error("getProducts:", error);
    res.status(500).json({ message: "Failed to retrieve products", ...(isDev && { error: error.message }) });
  }
};

// GET /api/products/:slug
export const getProductBySlug = async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findUnique({ where: { slug: String(req.params.slug) } });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (error: any) {
    console.error("getProductBySlug:", error);
    res.status(500).json({ message: "Failed to retrieve product", ...(isDev && { error: error.message }) });
  }
};

// POST /api/products — admin only
export const createProduct = async (req: Request, res: Response) => {
  try {
    const { slug, type, name, shortDescription, fullDescription, platform, version, downloadLabel, features, screenshots } = req.body;
    const files = req.files as any;

    // Required field validation
    if (!name) {
      return res.status(400).json({ message: "name is required." });
    }

    const uploadedCover = files?.coverImage?.[0]?.path ?? req.file?.path;
    const coverResult = resolveImageField(uploadedCover, req.body.coverImage, "Cover image", { required: true });
    if (!coverResult.ok) return res.status(400).json({ message: coverResult.error });
    const coverImage = coverResult.url;
    const uploadedScreenshots: string[] = (files?.screenshotFiles ?? []).map((f: any) => f.path);

    const featuresParsed = safeParseArray(features, "features");
    if (!featuresParsed.ok) return res.status(400).json({ message: featuresParsed.error });

    const screenshotsParsed = safeParseArray(screenshots, "screenshots");
    if (!screenshotsParsed.ok) return res.status(400).json({ message: screenshotsParsed.error });

    const screenshotUrls = validateImageUrlList(screenshotsParsed.data, "Screenshot URL");
    if (!screenshotUrls.ok) return res.status(400).json({ message: screenshotUrls.error });

    const finalSlug = await generateUniqueSlug(slug || name, "product");

    const product = await prisma.product.create({
      data: {
        slug: finalSlug, type, name, shortDescription, fullDescription, coverImage,
        platform, version, downloadLabel,
        features: featuresParsed.data,
        screenshots: [...screenshotUrls.urls, ...uploadedScreenshots],
      },
    });

    res.status(201).json(product);
  } catch (error: any) {
    console.error("createProduct:", error);
    res.status(500).json({ message: "Failed to create product", ...(isDev && { error: error.message }) });
  }
};

// PUT /api/products/:id — admin only
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const productId = String(req.params.id);
    const current = await prisma.product.findUnique({ where: { id: productId } });
    if (!current) return res.status(404).json({ message: "Product not found" });

    const { slug, type, name, shortDescription, fullDescription, platform, version, downloadLabel, features, screenshots } = req.body;
    const files = req.files as any;

    const newCoverImage = files?.coverImage?.[0]?.path ?? req.file?.path;
    const uploadedScreenshots: string[] = (files?.screenshotFiles ?? []).map((f: any) => f.path);

    const featuresParsed = safeParseArray(features, "features");
    if (!featuresParsed.ok) return res.status(400).json({ message: featuresParsed.error });

    const screenshotsParsed = safeParseArray(screenshots, "screenshots");
    if (!screenshotsParsed.ok) return res.status(400).json({ message: screenshotsParsed.error });

    const screenshotUrls = validateImageUrlList(screenshotsParsed.data, "Screenshot URL");
    if (!screenshotUrls.ok) return res.status(400).json({ message: screenshotUrls.error });

    let coverImage = current.coverImage;
    if (newCoverImage) {
      coverImage = newCoverImage;
    } else if (req.body.coverImage !== undefined && req.body.coverImage !== "") {
      const coverResult = resolveImageField(undefined, req.body.coverImage, "Cover image", { required: true });
      if (!coverResult.ok) return res.status(400).json({ message: coverResult.error });
      coverImage = coverResult.url;
    }

    let finalSlug = current.slug;
    if (slug !== undefined) {
      finalSlug = await generateUniqueSlug(slug || name || current.name, "product", productId);
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        slug: finalSlug,
        ...(type             !== undefined && { type }),
        ...(name             !== undefined && { name }),
        ...(shortDescription !== undefined && { shortDescription }),
        ...(fullDescription  !== undefined && { fullDescription }),
        ...(platform         !== undefined && { platform }),
        ...(version          !== undefined && { version }),
        ...(downloadLabel    !== undefined && { downloadLabel }),
        coverImage,
        features: featuresParsed.data.length > 0 ? featuresParsed.data : (current.features as string[]),
        screenshots: [...screenshotUrls.urls, ...uploadedScreenshots],
      },
    });

    res.json(product);
  } catch (error: any) {
    console.error("updateProduct:", error);
    res.status(500).json({ message: "Failed to update product", ...(isDev && { error: error.message }) });
  }
};

// DELETE /api/products/:id — admin only
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const productId = String(req.params.id);
    const current = await prisma.product.findUnique({ where: { id: productId } });
    if (!current) return res.status(404).json({ message: "Product not found" });

    await prisma.product.delete({ where: { id: productId } });
    res.json({ message: "Product removed." });
  } catch (error: any) {
    console.error("deleteProduct:", error);
    res.status(500).json({ message: "Failed to delete product", ...(isDev && { error: error.message }) });
  }
};
