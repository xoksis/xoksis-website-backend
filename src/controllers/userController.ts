import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { cloudinary } from '../config/cloudinary';
import { setAuthCookie } from '../utils/authToken';
import { clearUserCache } from '../middleware/authMiddleware';

const isDev = process.env.NODE_ENV !== 'production';

const ALLOWED_USER_TYPES = ['student', 'professional', 'educator', 'hobbyist', 'other'];
const ALLOWED_LANGUAGES  = ['en', 'ur', 'ar', 'fr', 'de', 'es', 'tr', 'zh', 'hi'];

function getCloudinaryPublicId(url: string): string | null {
  try {
    if (!url || !url.includes('cloudinary.com')) return null;
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    const remaining = parts[1];
    const pathParts = remaining.split('/');
    if (pathParts[0].startsWith('v') && !isNaN(Number(pathParts[0].substring(1)))) {
      pathParts.shift();
    }
    const withExtension = pathParts.join('/');
    const lastDotIndex = withExtension.lastIndexOf('.');
    return lastDotIndex !== -1 ? withExtension.substring(0, lastDotIndex) : withExtension;
  } catch {
    return null;
  }
}

// POST /api/users/onboarding
export const completeOnboarding = async (req: any, res: Response) => {
  try {
    const { firstName, lastName, country, interests, skillLevel, goal, userType } = req.body;

    // Whitelist userType — prevent privilege escalation via mass assignment
    const safeUserType = ALLOWED_USER_TYPES.includes(userType) ? userType : undefined;

    const data: any = {
      interests,
      skillLevel,
      goal,
      onboardingDone: true,
      ...(safeUserType !== undefined && { userType: safeUserType }),
    };
    if (firstName) {
      data.firstName = firstName;
      data.lastName = lastName || '';
      data.name = lastName ? `${firstName} ${lastName}` : firstName;
    }
    if (country) data.country = country;

    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    const { password, ...safeUser } = user as any;
    res.json(safeUser);
  } catch (error: any) {
    console.error('completeOnboarding:', error);
    res.status(500).json({ message: 'Onboarding failed.', ...(isDev && { error: error.message }) });
  }
};

// POST /api/users/avatar
export const updateAvatar = async (req: any, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { avatar: true },
    });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatar: (req.file as any).path },
    });

    if (currentUser?.avatar) {
      const publicId = getCloudinaryPublicId(currentUser.avatar);
      if (publicId) {
        cloudinary.uploader.destroy(publicId).catch((err) => {
          console.error('Failed to delete old avatar from Cloudinary:', err);
        });
      }
    }

    const { password, ...safeUser } = user as any;
    res.json(safeUser);
  } catch (error: any) {
    console.error('updateAvatar:', error);
    res.status(500).json({ message: 'Failed to update avatar.', ...(isDev && { error: error.message }) });
  }
};

// PUT /api/users/profile
export const updateProfile = async (req: any, res: Response) => {
  try {
    const { phone, language } = req.body;

    // Validate phone: digits, spaces, dashes, plus only — max 20 chars
    if (phone !== undefined) {
      if (typeof phone !== 'string' || phone.length > 20 || !/^[+\d\s\-()]*$/.test(phone)) {
        return res.status(400).json({ message: 'Invalid phone number format.' });
      }
    }

    // Validate language against allowlist
    if (language !== undefined && !ALLOWED_LANGUAGES.includes(language)) {
      return res.status(400).json({ message: `Invalid language. Allowed: ${ALLOWED_LANGUAGES.join(', ')}` });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(phone    !== undefined && { phone }),
        ...(language !== undefined && { language }),
      },
    });
    const { password, ...safeUser } = user as any;
    res.json(safeUser);
  } catch (error: any) {
    console.error('updateProfile:', error);
    res.status(500).json({ message: 'Failed to update profile.', ...(isDev && { error: error.message }) });
  }
};

// PUT /api/users/password
export const changePassword = async (req: any, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new passwords are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must differ from the current password.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (!user.password) {
      return res.status(400).json({
        message: 'Your account uses Google sign-in. Use the forgot password flow to set a password.',
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashed, tokenVersion: { increment: 1 } },
    });
    clearUserCache(updated.id);
    setAuthCookie(res, updated.id, updated.tokenVersion);
    res.json({ message: 'Password updated successfully.' });
  } catch (error: any) {
    console.error('changePassword:', error);
    res.status(500).json({ message: 'Failed to change password.', ...(isDev && { error: error.message }) });
  }
};
