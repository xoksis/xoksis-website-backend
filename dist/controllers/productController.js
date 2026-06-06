import prisma from '../config/prisma';
export const getProducts = async (req, res) => {
    const products = await prisma.product.findMany();
    res.json(products);
};
export const getProductBySlug = async (req, res) => {
    const product = await prisma.product.findUnique({ where: { slug: req.params.slug } });
    if (product) {
        res.json(product);
    }
    else {
        res.status(404).json({ message: 'Product not found' });
    }
};
export const createProduct = async (req, res) => {
    const { slug, type, name, shortDescription, fullDescription, platform, version, downloadLabel, features } = req.body;
    const coverImage = req.file ? req.file.path : req.body.coverImage;
    const product = await prisma.product.create({
        data: {
            slug,
            type,
            name,
            shortDescription,
            fullDescription,
            coverImage,
            platform,
            version,
            downloadLabel,
            features: Array.isArray(features) ? features : JSON.parse(features),
        },
    });
    res.status(201).json(product);
};
export const updateProduct = async (req, res) => {
    const { type, name, shortDescription, fullDescription, platform, version, downloadLabel, features } = req.body;
    const coverImage = req.file ? req.file.path : req.body.coverImage;
    const product = await prisma.product.update({
        where: { id: req.params.id },
        data: {
            type,
            name,
            shortDescription,
            fullDescription,
            coverImage,
            platform,
            version,
            downloadLabel,
            features: Array.isArray(features) ? features : JSON.parse(features),
        },
    });
    res.json(product);
};
export const deleteProduct = async (req, res) => {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ message: 'Product removed' });
};
