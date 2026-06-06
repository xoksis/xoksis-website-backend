import prisma from '../config/prisma';
export const getFAQs = async (req, res) => {
    try {
        const faqs = await prisma.fAQ.findMany({ orderBy: { order: 'asc' } });
        res.json(faqs);
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching FAQs', error: error.message });
    }
};
export const createFAQ = async (req, res) => {
    const { question, answer, order } = req.body;
    try {
        const faq = await prisma.fAQ.create({
            data: { question, answer, order: parseInt(order) || 0 },
        });
        res.status(201).json(faq);
    }
    catch (error) {
        res.status(500).json({ message: 'Error creating FAQ', error: error.message });
    }
};
export const updateFAQ = async (req, res) => {
    const { question, answer, order } = req.body;
    try {
        const faq = await prisma.fAQ.update({
            where: { id: req.params.id },
            data: { question, answer, order: parseInt(order) || 0 },
        });
        res.json(faq);
    }
    catch (error) {
        res.status(500).json({ message: 'Error updating FAQ', error: error.message });
    }
};
export const deleteFAQ = async (req, res) => {
    try {
        await prisma.fAQ.delete({ where: { id: req.params.id } });
        res.json({ message: 'FAQ deleted' });
    }
    catch (error) {
        res.status(500).json({ message: 'Error deleting FAQ', error: error.message });
    }
};
export const getJourneySteps = async (req, res) => {
    try {
        const steps = await prisma.journeyStep.findMany({ orderBy: { order: 'asc' } });
        res.json(steps);
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching journey steps', error: error.message });
    }
};
export const createJourneyStep = async (req, res) => {
    const { number, title, subtitle, description, order } = req.body;
    try {
        const step = await prisma.journeyStep.create({
            data: { number, title, subtitle, description, order: parseInt(order) || 0 },
        });
        res.status(201).json(step);
    }
    catch (error) {
        res.status(500).json({ message: 'Error creating journey step', error: error.message });
    }
};
export const updateJourneyStep = async (req, res) => {
    const { number, title, subtitle, description, order } = req.body;
    try {
        const step = await prisma.journeyStep.update({
            where: { id: req.params.id },
            data: { number, title, subtitle, description, order: parseInt(order) || 0 },
        });
        res.json(step);
    }
    catch (error) {
        res.status(500).json({ message: 'Error updating journey step', error: error.message });
    }
};
export const deleteJourneyStep = async (req, res) => {
    try {
        await prisma.journeyStep.delete({ where: { id: req.params.id } });
        res.json({ message: 'Journey step deleted' });
    }
    catch (error) {
        res.status(500).json({ message: 'Error deleting journey step', error: error.message });
    }
};
