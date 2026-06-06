import prisma from '../config/prisma';
export const getCourses = async (req, res) => {
    const courses = await prisma.course.findMany();
    res.json(courses);
};
export const getCourseById = async (req, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (course) {
        res.json(course);
    }
    else {
        res.status(404).json({ message: 'Course not found' });
    }
};
export const createCourse = async (req, res) => {
    const { title, desc, tag, cat, level, price, hours, badge, intro, originalPrice, instructorName, instructorRole, instructorBio, instructorAvatar, prerequisites, curriculum, feedback } = req.body;
    const image = req.file ? req.file.path : req.body.image;
    try {
        const course = await prisma.course.create({
            data: {
                title,
                desc,
                tag,
                cat,
                level,
                price,
                hours,
                image,
                badge,
                intro,
                originalPrice,
                instructorName,
                instructorRole,
                instructorBio,
                instructorAvatar,
                prerequisites: Array.isArray(prerequisites) ? prerequisites : JSON.parse(prerequisites || '[]'),
                curriculum: typeof curriculum === 'string' ? JSON.parse(curriculum || '[]') : curriculum,
                feedback: typeof feedback === 'string' ? JSON.parse(feedback || '[]') : feedback,
            },
        });
        res.status(201).json(course);
    }
    catch (error) {
        res.status(500).json({ message: 'Error creating course', error: error.message });
    }
};
export const updateCourse = async (req, res) => {
    const { title, desc, tag, cat, level, price, hours, badge, intro, originalPrice, instructorName, instructorRole, instructorBio, instructorAvatar, prerequisites, curriculum, feedback } = req.body;
    const image = req.file ? req.file.path : req.body.image;
    try {
        const course = await prisma.course.update({
            where: { id: req.params.id },
            data: {
                title,
                desc,
                tag,
                cat,
                level,
                price,
                hours,
                image,
                badge,
                intro,
                originalPrice,
                instructorName,
                instructorRole,
                instructorBio,
                instructorAvatar,
                prerequisites: Array.isArray(prerequisites) ? prerequisites : JSON.parse(prerequisites || '[]'),
                curriculum: typeof curriculum === 'string' ? JSON.parse(curriculum || '[]') : curriculum,
                feedback: typeof feedback === 'string' ? JSON.parse(feedback || '[]') : feedback,
            },
        });
        res.json(course);
    }
    catch (error) {
        res.status(500).json({ message: 'Error updating course', error: error.message });
    }
};
export const deleteCourse = async (req, res) => {
    try {
        await prisma.course.delete({ where: { id: req.params.id } });
        res.json({ message: 'Course removed' });
    }
    catch (error) {
        res.status(500).json({ message: 'Error deleting course', error: error.message });
    }
};
