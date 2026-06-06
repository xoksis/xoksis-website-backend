import prisma from "../config/prisma";
const isDev = process.env.NODE_ENV !== "production";
function safeParseJson(value, fieldName) {
    if (Array.isArray(value))
        return { ok: true, data: value };
    if (value === undefined || value === null)
        return { ok: true, data: [] };
    if (typeof value === "string") {
        try {
            return { ok: true, data: JSON.parse(value) };
        }
        catch {
            return { ok: false, error: `${fieldName} must be valid JSON.` };
        }
    }
    if (typeof value === "object")
        return { ok: true, data: value };
    return { ok: false, error: `${fieldName} must be a JSON array or string.` };
}
// GET /api/courses?page=1&limit=20
export const getCourses = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
        const skip = (page - 1) * limit;
        const [courses, total] = await Promise.all([
            prisma.course.findMany({
                skip,
                take: limit,
                select: {
                    id: true, title: true, desc: true, tag: true, cat: true,
                    level: true, price: true, originalPrice: true, hours: true,
                    startDate: true,
                    image: true, badge: true, intro: true,
                    instructorName: true, instructorRole: true, instructorAvatar: true,
                    prerequisites: true, createdAt: true,
                },
            }),
            prisma.course.count(),
        ]);
        res.json({ data: courses, total, page, totalPages: Math.ceil(total / limit) });
    }
    catch (error) {
        console.error("getCourses:", error);
        res.status(500).json({ message: "Failed to retrieve courses", ...(isDev && { error: error.message }) });
    }
};
// GET /api/courses/:id
export const getCourseById = async (req, res) => {
    try {
        const course = await prisma.course.findUnique({ where: { id: String(req.params.id) } });
        if (!course)
            return res.status(404).json({ message: "Course not found" });
        res.json(course);
    }
    catch (error) {
        console.error("getCourseById:", error);
        res.status(500).json({ message: "Failed to retrieve course", ...(isDev && { error: error.message }) });
    }
};
// POST /api/courses — admin only
export const createCourse = async (req, res) => {
    try {
        const { title, desc, tag, cat, level, price, hours, badge, intro, originalPrice, startDate, instructorName, instructorRole, instructorBio, instructorAvatar, prerequisites, curriculum, feedback, } = req.body;
        // Required field validation
        if (!title || !price) {
            return res.status(400).json({ message: "title and price are required." });
        }
        const image = req.file ? req.file.path : req.body.image;
        // Safe JSON parsing
        const prereqParsed = safeParseJson(prerequisites, "prerequisites");
        if (!prereqParsed.ok)
            return res.status(400).json({ message: prereqParsed.error });
        const curriculumParsed = safeParseJson(curriculum, "curriculum");
        if (!curriculumParsed.ok)
            return res.status(400).json({ message: curriculumParsed.error });
        const feedbackParsed = safeParseJson(feedback, "feedback");
        if (!feedbackParsed.ok)
            return res.status(400).json({ message: feedbackParsed.error });
        const course = await prisma.course.create({
            data: {
                title, desc, tag, cat, level,
                price: String(price),
                hours: hours ? String(hours) : null,
                startDate: startDate ? String(startDate) : null,
                image, badge, intro,
                originalPrice: originalPrice ? String(originalPrice) : "",
                instructorName, instructorRole, instructorBio, instructorAvatar,
                prerequisites: prereqParsed.data,
                curriculum: curriculumParsed.data,
                feedback: feedbackParsed.data,
            },
        });
        res.status(201).json(course);
    }
    catch (error) {
        console.error("createCourse:", error);
        res.status(500).json({ message: "Failed to create course", ...(isDev && { error: error.message }) });
    }
};
// PUT /api/courses/:id — admin only
export const updateCourse = async (req, res) => {
    try {
        const courseId = String(req.params.id);
        const existing = await prisma.course.findUnique({ where: { id: courseId } });
        if (!existing)
            return res.status(404).json({ message: "Course not found." });
        const { title, desc, tag, cat, level, price, hours, badge, intro, originalPrice, startDate, instructorName, instructorRole, instructorBio, instructorAvatar, prerequisites, curriculum, feedback, } = req.body;
        // Preserve existing image if no new upload and no body.image sent
        const newImage = req.file ? req.file.path : req.body.image;
        const image = newImage ?? existing.image;
        const prereqParsed = safeParseJson(prerequisites, "prerequisites");
        if (!prereqParsed.ok)
            return res.status(400).json({ message: prereqParsed.error });
        const curriculumParsed = safeParseJson(curriculum, "curriculum");
        if (!curriculumParsed.ok)
            return res.status(400).json({ message: curriculumParsed.error });
        const feedbackParsed = safeParseJson(feedback, "feedback");
        if (!feedbackParsed.ok)
            return res.status(400).json({ message: feedbackParsed.error });
        const course = await prisma.course.update({
            where: { id: courseId },
            data: {
                ...(title !== undefined && { title }),
                ...(desc !== undefined && { desc }),
                ...(tag !== undefined && { tag }),
                ...(cat !== undefined && { cat }),
                ...(level !== undefined && { level }),
                ...(price !== undefined && { price: String(price) }),
                ...(hours !== undefined && { hours: hours ? String(hours) : null }),
                ...(startDate !== undefined && { startDate: startDate ? String(startDate) : null }),
                image,
                ...(badge !== undefined && { badge }),
                ...(intro !== undefined && { intro }),
                ...(originalPrice !== undefined && { originalPrice: String(originalPrice) }),
                ...(instructorName !== undefined && { instructorName }),
                ...(instructorRole !== undefined && { instructorRole }),
                ...(instructorBio !== undefined && { instructorBio }),
                ...(instructorAvatar !== undefined && { instructorAvatar }),
                ...(prerequisites !== undefined && { prerequisites: prereqParsed.data }),
                ...(curriculum !== undefined && { curriculum: curriculumParsed.data }),
                ...(feedback !== undefined && { feedback: feedbackParsed.data }),
            },
        });
        res.json(course);
    }
    catch (error) {
        console.error("updateCourse:", error);
        res.status(500).json({ message: "Failed to update course", ...(isDev && { error: error.message }) });
    }
};
// DELETE /api/courses/:id — admin only
export const deleteCourse = async (req, res) => {
    try {
        const courseId = String(req.params.id);
        const existing = await prisma.course.findUnique({ where: { id: courseId } });
        if (!existing)
            return res.status(404).json({ message: "Course not found." });
        // Warn if active enrollments exist
        const activeCount = await prisma.enrollment.count({
            where: { courseId, accessStatus: "active" },
        });
        if (activeCount > 0) {
            return res.status(409).json({
                message: `Cannot delete: ${activeCount} student(s) are actively enrolled in this course.`,
            });
        }
        await prisma.course.delete({ where: { id: courseId } });
        res.json({ message: "Course removed." });
    }
    catch (error) {
        console.error("deleteCourse:", error);
        res.status(500).json({ message: "Failed to delete course", ...(isDev && { error: error.message }) });
    }
};
// POST /api/courses/:id/enroll
export const enrollCourse = async (req, res) => {
    try {
        const courseId = String(req.params.id);
        const userId = req.user.id;
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course)
            return res.status(404).json({ message: "Course not found" });
        // Use upsert so concurrent requests are safe (DB unique constraint is the real guard)
        const existing = await prisma.enrollment.findFirst({ where: { userId, courseId } });
        if (existing)
            return res.status(409).json({ message: "Already enrolled" });
        const enrollment = await prisma.enrollment.create({ data: { userId, courseId } });
        res.status(201).json(enrollment);
    }
    catch (error) {
        // Handle unique constraint violation (race condition fallback)
        if (error.code === "P2002") {
            return res.status(409).json({ message: "Already enrolled" });
        }
        console.error("enrollCourse:", error);
        res.status(500).json({ message: "Enrollment failed", ...(isDev && { error: error.message }) });
    }
};
// DELETE /api/courses/:id/enroll
export const unenrollCourse = async (req, res) => {
    try {
        const courseId = String(req.params.id);
        const userId = req.user.id;
        const result = await prisma.enrollment.deleteMany({ where: { userId, courseId } });
        if (result.count === 0) {
            return res.status(404).json({ message: "No enrollment found to remove." });
        }
        res.json({ message: "Unenrolled successfully." });
    }
    catch (error) {
        console.error("unenrollCourse:", error);
        res.status(500).json({ message: "Failed to unenroll", ...(isDev && { error: error.message }) });
    }
};
