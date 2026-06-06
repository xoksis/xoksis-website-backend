import express from 'express';
import { getTeamMembers, createTeamMember, updateTeamMember, deleteTeamMember } from '../controllers/teamController';
import { protect, admin } from '../middleware/authMiddleware';
import { upload } from '../config/cloudinary';
import { uploadLimiter } from '../middleware/rateLimitPresets';

const router = express.Router();

router.get('/', getTeamMembers);
router.post('/', protect, admin, uploadLimiter, upload.single('image'), createTeamMember);
router.put('/:id', protect, admin, uploadLimiter, upload.single('image'), updateTeamMember);
router.delete('/:id', protect, admin, deleteTeamMember);

export default router;
