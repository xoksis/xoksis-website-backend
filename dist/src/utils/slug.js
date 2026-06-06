import prisma from "../config/prisma";
export function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(/[^\w\-]+/g, '') // Remove all non-word chars
        .replace(/\-\-+/g, '-') // Replace multiple - with single -
        .replace(/^-+/, '') // Trim - from start
        .replace(/-+$/, ''); // Trim - from end
}
export async function generateUniqueSlug(baseString, modelName, currentId) {
    let slug = slugify(baseString);
    if (!slug) {
        slug = "item"; // Fallback if input generates an empty slug
    }
    const prismaModel = prisma[modelName];
    if (!prismaModel) {
        throw new Error(`Prisma model ${modelName} not found.`);
    }
    let uniqueSlug = slug;
    let counter = 1;
    while (true) {
        const existing = await prismaModel.findFirst({
            where: {
                slug: uniqueSlug,
                ...(currentId && { NOT: { id: currentId } }),
            },
        });
        if (!existing) {
            return uniqueSlug;
        }
        uniqueSlug = `${slug}-${counter}`;
        counter++;
    }
}
