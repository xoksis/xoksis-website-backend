import prisma from '../config/prisma';
export const getBlogPosts = async (req, res) => {
    const posts = await prisma.blogPost.findMany({ include: { author: { select: { name: true, role: true, avatar: true } } } });
    res.json(posts);
};
export const getBlogPostBySlug = async (req, res) => {
    const post = await prisma.blogPost.findUnique({ where: { slug: req.params.slug }, include: { author: { select: { name: true, role: true, avatar: true } } } });
    if (post) {
        res.json(post);
    }
    else {
        res.status(404).json({ message: 'Blog post not found' });
    }
};
export const createBlogPost = async (req, res) => {
    const { slug, category, title, excerpt, readTime, publishedAt, sections } = req.body;
    const coverImage = req.file ? req.file.path : req.body.coverImage;
    const post = await prisma.blogPost.create({
        data: {
            slug,
            category,
            title,
            excerpt,
            coverImage,
            readTime,
            publishedAt,
            authorId: req.user.id,
            sections: typeof sections === 'string' ? JSON.parse(sections) : sections,
        },
    });
    res.status(201).json(post);
};
export const updateBlogPost = async (req, res) => {
    // Similar to create, using prisma.blogPost.update
};
export const deleteBlogPost = async (req, res) => {
    await prisma.blogPost.delete({ where: { id: req.params.id } });
    res.json({ message: 'Blog post removed' });
};
