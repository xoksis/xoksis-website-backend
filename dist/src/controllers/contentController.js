import prisma from "../config/prisma";
const isDev = process.env.NODE_ENV !== "production";
export const getSiteContent = async (req, res) => {
    const key = String(req.params.key);
    try {
        const content = await prisma.siteContent.findUnique({ where: { key } });
        if (content) {
            res.json(content.content);
        }
        else {
            res.status(404).json({ message: "Content not found" });
        }
    }
    catch (error) {
        console.error("getSiteContent:", error);
        res
            .status(500)
            .json({ message: "Error fetching site content", ...(isDev && { error: error.message }) });
    }
};
export const updateSiteContent = async (req, res) => {
    const key = String(req.params.key);
    let { content } = req.body;
    try {
        // If sent via FormData, content might be a stringified JSON
        if (typeof content === "string") {
            try {
                content = JSON.parse(content);
            }
            catch {
                return res.status(400).json({ message: "content must be a valid JSON string." });
            }
        }
        // If an image was uploaded, update the image field in content
        if (req.file) {
            // For now, we assume the top-level 'image' property is the target
            // This covers about_hero and about_journey
            content.image = req.file.path;
        }
        const updatedContent = await prisma.siteContent.upsert({
            where: { key },
            update: { content },
            create: { key, content },
        });
        res.json(updatedContent.content);
    }
    catch (error) {
        console.error("updateSiteContent:", error);
        res
            .status(500)
            .json({ message: "Error updating site content", ...(isDev && { error: error.message }) });
    }
};
