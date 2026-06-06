import prisma from "../config/prisma";
const isDev = process.env.NODE_ENV !== "production";
export const getFAQs = async (req, res) => {
    try {
        const faqs = await prisma.fAQ.findMany({ orderBy: { order: "asc" } });
        res.json(faqs);
    }
    catch (error) {
        console.error("getFAQs:", error);
        res
            .status(500)
            .json({ message: "Error fetching FAQs", ...(isDev && { error: error.message }) });
    }
};
export const createFAQ = async (req, res) => {
    const { question, answer, order } = req.body;
    if (!question || !answer) {
        return res.status(400).json({ message: "Question and Answer are required." });
    }
    try {
        const faq = await prisma.fAQ.create({
            data: { question, answer, order: parseInt(order) || 0 },
        });
        res.status(201).json(faq);
    }
    catch (error) {
        console.error("createFAQ:", error);
        res
            .status(500)
            .json({ message: "Error creating FAQ", ...(isDev && { error: error.message }) });
    }
};
export const updateFAQ = async (req, res) => {
    const { question, answer, order } = req.body;
    try {
        const faqId = String(req.params.id);
        const existing = await prisma.fAQ.findUnique({ where: { id: faqId } });
        if (!existing)
            return res.status(404).json({ message: "FAQ not found." });
        const faq = await prisma.fAQ.update({
            where: { id: faqId },
            data: {
                ...(question !== undefined && { question }),
                ...(answer !== undefined && { answer }),
                ...(order !== undefined && { order: parseInt(order) || 0 }),
            },
        });
        res.json(faq);
    }
    catch (error) {
        console.error("updateFAQ:", error);
        res
            .status(500)
            .json({ message: "Error updating FAQ", ...(isDev && { error: error.message }) });
    }
};
export const deleteFAQ = async (req, res) => {
    try {
        const faqId = String(req.params.id);
        const existing = await prisma.fAQ.findUnique({ where: { id: faqId } });
        if (!existing)
            return res.status(404).json({ message: "FAQ not found." });
        await prisma.fAQ.delete({ where: { id: faqId } });
        res.json({ message: "FAQ deleted" });
    }
    catch (error) {
        console.error("deleteFAQ:", error);
        res
            .status(500)
            .json({ message: "Error deleting FAQ", ...(isDev && { error: error.message }) });
    }
};
export const getJourneySteps = async (req, res) => {
    try {
        const steps = await prisma.journeyStep.findMany({
            orderBy: { order: "asc" },
        });
        res.json(steps);
    }
    catch (error) {
        console.error("getJourneySteps:", error);
        res
            .status(500)
            .json({ message: "Error fetching journey steps", ...(isDev && { error: error.message }) });
    }
};
export const createJourneyStep = async (req, res) => {
    const { number, title, subtitle, description, order } = req.body;
    if (!number || !title || !description) {
        return res.status(400).json({ message: "Number, Title, and Description are required." });
    }
    try {
        const step = await prisma.journeyStep.create({
            data: {
                number,
                title,
                subtitle: subtitle || "",
                description,
                order: parseInt(order) || 0,
            },
        });
        res.status(201).json(step);
    }
    catch (error) {
        console.error("createJourneyStep:", error);
        res
            .status(500)
            .json({ message: "Error creating journey step", ...(isDev && { error: error.message }) });
    }
};
export const updateJourneyStep = async (req, res) => {
    const { number, title, subtitle, description, order } = req.body;
    try {
        const journeyStepId = String(req.params.id);
        const existing = await prisma.journeyStep.findUnique({ where: { id: journeyStepId } });
        if (!existing)
            return res.status(404).json({ message: "Journey step not found." });
        const step = await prisma.journeyStep.update({
            where: { id: journeyStepId },
            data: {
                ...(number !== undefined && { number }),
                ...(title !== undefined && { title }),
                ...(subtitle !== undefined && { subtitle }),
                ...(description !== undefined && { description }),
                ...(order !== undefined && { order: parseInt(order) || 0 }),
            },
        });
        res.json(step);
    }
    catch (error) {
        console.error("updateJourneyStep:", error);
        res
            .status(500)
            .json({ message: "Error updating journey step", ...(isDev && { error: error.message }) });
    }
};
export const deleteJourneyStep = async (req, res) => {
    try {
        const journeyStepId = String(req.params.id);
        const existing = await prisma.journeyStep.findUnique({ where: { id: journeyStepId } });
        if (!existing)
            return res.status(404).json({ message: "Journey step not found." });
        await prisma.journeyStep.delete({ where: { id: journeyStepId } });
        res.json({ message: "Journey step deleted" });
    }
    catch (error) {
        console.error("deleteJourneyStep:", error);
        res
            .status(500)
            .json({ message: "Error deleting journey step", ...(isDev && { error: error.message }) });
    }
};
