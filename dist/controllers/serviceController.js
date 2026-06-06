import prisma from '../config/prisma';
export const getServices = async (req, res) => {
    const services = await prisma.service.findMany();
    res.json(services);
};
export const getServiceBySlug = async (req, res) => {
    const service = await prisma.service.findUnique({ where: { slug: req.params.slug } });
    if (service) {
        res.json(service);
    }
    else {
        res.status(404).json({ message: 'Service not found' });
    }
};
export const createService = async (req, res) => {
    const { slug, title, shortTitle, shortDescription, longDescription, accent, icon, highlights, process, technologies, team } = req.body;
    const image = req.file ? req.file.path : req.body.image;
    const service = await prisma.service.create({
        data: {
            slug,
            title,
            shortTitle,
            shortDescription,
            longDescription,
            image,
            accent,
            icon,
            highlights: Array.isArray(highlights) ? highlights : JSON.parse(highlights),
            process: Array.isArray(process) ? process : JSON.parse(process),
            technologies: Array.isArray(technologies) ? technologies : JSON.parse(technologies),
            team: typeof team === 'string' ? JSON.parse(team) : team,
        },
    });
    res.status(201).json(service);
};
export const updateService = async (req, res) => {
    const { title, shortTitle, shortDescription, longDescription, accent, icon, highlights, process, technologies, team } = req.body;
    const image = req.file ? req.file.path : req.body.image;
    try {
        const service = await prisma.service.update({
            where: { id: req.params.id },
            data: {
                title,
                shortTitle,
                shortDescription,
                longDescription,
                image,
                accent,
                icon,
                highlights: Array.isArray(highlights) ? highlights : JSON.parse(highlights || '[]'),
                process: Array.isArray(process) ? process : JSON.parse(process || '[]'),
                technologies: Array.isArray(technologies) ? technologies : JSON.parse(technologies || '[]'),
                team: typeof team === 'string' ? JSON.parse(team || '[]') : team,
            },
        });
        res.json(service);
    }
    catch (error) {
        res.status(500).json({ message: 'Error updating service', error: error.message });
    }
};
export const deleteService = async (req, res) => {
    try {
        await prisma.service.delete({ where: { id: req.params.id } });
        res.json({ message: 'Service deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ message: 'Error deleting service', error: error.message });
    }
};
