import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};
export const registerUser = async (req, res) => {
    const { firstName, lastName, email, password, country, dob } = req.body;
    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) {
        return res.status(400).json({ message: 'User already exists' });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = await prisma.user.create({
        data: {
            firstName,
            lastName,
            name: `${firstName} ${lastName}`,
            email,
            password: hashedPassword,
            country,
            dob,
        },
    });
    if (user) {
        res.status(201).json({
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            token: generateToken(user.id),
        });
    }
    else {
        res.status(400).json({ message: 'Invalid user data' });
    }
};
export const loginUser = async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && (await bcrypt.compare(password, user.password))) {
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            onboardingDone: user.onboardingDone,
            token: generateToken(user.id),
        });
    }
    else {
        res.status(401).json({ message: 'Invalid email or password' });
    }
};
export const getUserProfile = async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
            enrollments: true,
            subscriptions: true,
            certificates: true,
            notifications: true
        }
    });
    if (user) {
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    }
    else {
        res.status(404).json({ message: 'User not found' });
    }
};
