import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../config/prisma";
import { generateUniqueSlug } from "../utils/slug";
import { resolveImageField, validateOptionalImageUrl } from "../utils/imageUrl";

const isDev = process.env.NODE_ENV !== "production";

// GET /api/blogs?page=1&limit=20
export const getBlogPosts = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  || "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
    const skip  = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        skip,
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: { author: { select: { name: true, role: true, avatar: true } } },
      }),
      prisma.blogPost.count(),
    ]);

    res.json({ data: posts, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    console.error("getBlogPosts:", error);
    res.status(500).json({ message: "Failed to retrieve blog posts", ...(isDev && { error: error.message }) });
  }
};

// GET /api/blogs/:slug
export const getBlogPostBySlug = async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const post = await prisma.blogPost.findUnique({
      where: { slug },
      include: { author: { select: { name: true, role: true, avatar: true } } },
    });
    if (!post) return res.status(404).json({ message: "Blog post not found" });
    res.json(post);
  } catch (error: any) {
    console.error("getBlogPostBySlug:", error);
    res.status(500).json({ message: "Failed to retrieve blog post", ...(isDev && { error: error.message }) });
  }
};

// POST /api/blogs — admin only
export const createBlogPost = async (req: AuthRequest, res: Response) => {
  try {
    const { slug, category, title, excerpt, readTime, publishedAt, sections } = req.body;

    if (!title || !category) {
      return res.status(400).json({ message: "title and category are required." });
    }

    // Validate publishedAt if supplied
    let parsedDate: Date | undefined;
    if (publishedAt) {
      parsedDate = new Date(publishedAt);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "publishedAt must be a valid ISO date string." });
      }
    }

    const uploadedCover = req.file ? (req.file as any).path : undefined;
    const coverResult = resolveImageField(uploadedCover, req.body.coverImage, "Cover image", { required: true });
    if (!coverResult.ok) return res.status(400).json({ message: coverResult.error });
    const coverImage = coverResult.url;

    let parsedSections = sections;
    if (typeof sections === "string") {
      try {
        parsedSections = JSON.parse(sections);
      } catch {
        return res.status(400).json({ message: "sections must be valid JSON." });
      }
    }

    const finalSlug = await generateUniqueSlug(slug || title, "blogPost");

    const post = await prisma.blogPost.create({
      data: {
        slug: finalSlug,
        category,
        title,
        excerpt,
        coverImage,
        readTime,
        publishedAt: (parsedDate ?? new Date()).toISOString(),
        authorId: req.user!.id,
        sections: parsedSections,
      },
    });

    res.status(201).json(post);
  } catch (error: any) {
    console.error("createBlogPost:", error);
    res.status(500).json({ message: "Failed to create blog post", ...(isDev && { error: error.message }) });
  }
};

// PUT /api/blogs/by-id/:id — admin only
export const updateBlogPost = async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Blog post not found." });

    const { slug, category, title, excerpt, readTime, publishedAt, sections } = req.body;

    let parsedDate: Date | undefined;
    if (publishedAt) {
      parsedDate = new Date(publishedAt);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "publishedAt must be a valid ISO date string." });
      }
    }

    let coverImage = existing.coverImage;
    if (req.file) {
      coverImage = (req.file as any).path;
    } else if (req.body.coverImage !== undefined) {
      const coverResult = validateOptionalImageUrl(req.body.coverImage, "Cover image");
      if (!coverResult.ok) return res.status(400).json({ message: coverResult.error });
      if (coverResult.url) coverImage = coverResult.url;
    }

    let parsedSections = sections;
    if (typeof sections === "string") {
      try {
        parsedSections = JSON.parse(sections);
      } catch {
        return res.status(400).json({ message: "sections must be valid JSON." });
      }
    }

    let finalSlug = existing.slug;
    if (slug !== undefined) {
      finalSlug = await generateUniqueSlug(slug || title || existing.title, "blogPost", id);
    }

    const updated = await prisma.blogPost.update({
      where: { id },
      data: {
        slug: finalSlug,
        ...(category !== undefined && { category }),
        ...(title    !== undefined && { title }),
        ...(excerpt  !== undefined && { excerpt }),
        coverImage,
        ...(readTime    !== undefined && { readTime }),
        ...(parsedDate  !== undefined && { publishedAt: parsedDate.toISOString() }),
        ...(parsedSections !== undefined && { sections: parsedSections }),
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error("updateBlogPost:", error);
    res.status(500).json({ message: "Failed to update blog post", ...(isDev && { error: error.message }) });
  }
};

// DELETE /api/blogs/by-id/:id — admin only
export const deleteBlogPost = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Blog post not found." });

    await prisma.blogPost.delete({ where: { id } });
    res.json({ message: "Blog post removed." });
  } catch (error: any) {
    console.error("deleteBlogPost:", error);
    res.status(500).json({ message: "Failed to delete blog post", ...(isDev && { error: error.message }) });
  }
};
