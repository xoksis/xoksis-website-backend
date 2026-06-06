import prisma from '../config/prisma';
export const getSiteContent = async (req, res) => {
    const { key } = req.params;
    try {
        const content = await prisma.siteContent.findUnique({ where: { key } });
        if (content) {
            res.json(content.content);
        }
        else {
            res.status(404).json({ message: 'Content not found' });
        }
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching site content', error: error.message });
    }
};
export const updateSiteContent = async (req, res) => {
    const { key } = req.params;
    let { content } = req.body;
    try {
        // If sent via FormData, content might be a stringified JSON
        if (typeof content === 'string') {
            content = JSON.parse(content);
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
        res.status(500).json({ message: 'Error updating site content', error: error.message });
    }
};
