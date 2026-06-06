import express from 'express';
import { getFAQs, createFAQ, updateFAQ, deleteFAQ, getJourneySteps, createJourneyStep, updateJourneyStep, deleteJourneyStep } from '../controllers/extraController';
import { protect, admin } from '../middleware/authMiddleware';

const router = express.Router();

router.route('/faq').get(getFAQs).post(protect, admin, createFAQ);
router.route('/faq/:id').put(protect, admin, updateFAQ).delete(protect, admin, deleteFAQ);

router.route('/journey').get(getJourneySteps).post(protect, admin, createJourneyStep);
router.route('/journey/:id').put(protect, admin, updateJourneyStep).delete(protect, admin, deleteJourneyStep);

export default router;
