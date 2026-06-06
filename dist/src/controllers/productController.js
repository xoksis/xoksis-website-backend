import prisma from "../config/prisma";
import { generateUniqueSlug } from "../utils/slug";
const isDev = process.env.NODE_ENV !== "production";
function safeParseArray(value, fieldName) {
    if (Array.isArray(value))
        return { ok: true, data: value };
    if (value === undefined || value === null || value === "")
        return { ok: true, data: [] };
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed))
                return { ok: false, error: `${fieldName} must be a JSON array.` };
            return { ok: true, data: parsed };
        }
        catch {
            return { ok: false, error: `${fieldName} must be valid JSON.` };
        }
    }
    return { ok: false, error: `${fieldName} must be a JSON array or string.` };
}
// GET /api/products?page=1&limit=20
export const getProducts = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
        const skip = (page - 1) * limit;
        const [products, total] = await Promise.all([
            prisma.product.findMany({ skip, take: limit }),
            prisma.product.count(),
        ]);
        res.json({ data: products, total, page, totalPages: Math.ceil(total / limit) });
    }
    catch (error) {
        console.error("getProducts:", error);
        res.status(500).json({ message: "Failed to retrieve products", ...(isDev && { error: error.message }) });
    }
};
// GET /api/products/:slug
export const getProductBySlug = async (req, res) => {
    try {
        const product = await prisma.product.findUnique({ where: { slug: String(req.params.slug) } });
        if (!product)
            return res.status(404).json({ message: "Product not found" });
        res.json(product);
    }
    catch (error) {
        console.error("getProductBySlug:", error);
        res.status(500).json({ message: "Failed to retrieve product", ...(isDev && { error: error.message }) });
    }
};
// POST /api/products — admin only
export const createProduct = async (req, res) => {
    try {
        const { slug, type, name, shortDescription, fullDescription, platform, version, downloadLabel, features, screenshots } = req.body;
        const files = req.files;
        // Required field validation
        if (!name) {
            return res.status(400).json({ message: "name is required." });
        }
        const coverImage = files?.coverImage?.[0]?.path ?? req.file?.path ?? req.body.coverImage;
        const uploadedScreenshots = (files?.screenshotFiles ?? []).map((f) => f.path);
        const featuresParsed = safeParseArray(features, "features");
        if (!featuresParsed.ok)
            return res.status(400).json({ message: featuresParsed.error });
        const screenshotsParsed = safeParseArray(screenshots, "screenshots");
        if (!screenshotsParsed.ok)
            return res.status(400).json({ message: screenshotsParsed.error });
        const finalSlug = await generateUniqueSlug(slug || name, "product");
        const product = await prisma.product.create({
            data: {
                slug: finalSlug, type, name, shortDescription, fullDescription, coverImage,
                platform, version, downloadLabel,
                features: featuresParsed.data,
                screenshots: [...screenshotsParsed.data, ...uploadedScreenshots],
            },
        });
        res.status(201).json(product);
    }
    catch (error) {
        console.error("createProduct:", error);
        res.status(500).json({ message: "Failed to create product", ...(isDev && { error: error.message }) });
    }
};
// PUT /api/products/:id — admin only
export const updateProduct = async (req, res) => {
    try {
        const productId = String(req.params.id);
        const current = await prisma.product.findUnique({ where: { id: productId } });
        if (!current)
            return res.status(404).json({ message: "Product not found" });
        const { slug, type, name, shortDescription, fullDescription, platform, version, downloadLabel, features, screenshots } = req.body;
        const files = req.files;
        const newCoverImage = files?.coverImage?.[0]?.path ?? req.file?.path;
        const uploadedScreenshots = (files?.screenshotFiles ?? []).map((f) => f.path);
        const featuresParsed = safeParseArray(features, "features");
        if (!featuresParsed.ok)
            return res.status(400).json({ message: featuresParsed.error });
        const screenshotsParsed = safeParseArray(screenshots, "screenshots");
        if (!screenshotsParsed.ok)
            return res.status(400).json({ message: screenshotsParsed.error });
        let finalSlug = current.slug;
        if (slug !== undefined) {
            finalSlug = await generateUniqueSlug(slug || name || current.name, "product", productId);
        }
        const product = await prisma.product.update({
            where: { id: productId },
            data: {
                slug: finalSlug,
                ...(type !== undefined && { type }),
                ...(name !== undefined && { name }),
                ...(shortDescription !== undefined && { shortDescription }),
                ...(fullDescription !== undefined && { fullDescription }),
                ...(platform !== undefined && { platform }),
                ...(version !== undefined && { version }),
                ...(downloadLabel !== undefined && { downloadLabel }),
                coverImage: newCoverImage ?? current.coverImage,
                features: featuresParsed.data.length > 0 ? featuresParsed.data : current.features,
                screenshots: [...screenshotsParsed.data, ...uploadedScreenshots],
            },
        });
        res.json(product);
    }
    catch (error) {
        console.error("updateProduct:", error);
        res.status(500).json({ message: "Failed to update product", ...(isDev && { error: error.message }) });
    }
};
// DELETE /api/products/:id — admin only
export const deleteProduct = async (req, res) => {
    try {
        const productId = String(req.params.id);
        const current = await prisma.product.findUnique({ where: { id: productId } });
        if (!current)
            return res.status(404).json({ message: "Product not found" });
        await prisma.product.delete({ where: { id: productId } });
        res.json({ message: "Product removed." });
    }
    catch (error) {
        console.error("deleteProduct:", error);
        res.status(500).json({ message: "Failed to delete product", ...(isDev && { error: error.message }) });
    }
};
