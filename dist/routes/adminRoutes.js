import express from 'express';
import { getStats, getAllUsers, updateUserRole, deleteUser } from '../controllers/adminController';
import { protect, admin } from '../middleware/authMiddleware';
const router = express.Router();
router.get('/stats', protect, admin, getStats);
router.get('/users', protect, admin, getAllUsers);
router.put('/users/:id/role', protect, admin, updateUserRole);
router.delete('/users/:id', protect, admin, deleteUser);
export default router;
