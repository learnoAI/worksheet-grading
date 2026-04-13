import express from 'express';
import { UserRole } from '@prisma/client';
import {
    getStudentMastery,
    getStudentMasteryByTopic,
    getStudentRecommendations,
    getClassMasteryOverview,
    backfillMastery
} from '../controllers/masteryController';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

router.use(auth);

// Student mastery endpoints (TEACHER, ADMIN, SUPERADMIN)
router.get(
    '/student/:studentId',
    authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
    asHandler(getStudentMastery)
);

router.get(
    '/student/:studentId/by-topic',
    authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
    asHandler(getStudentMasteryByTopic)
);

router.get(
    '/student/:studentId/recommendations',
    authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
    asHandler(getStudentRecommendations)
);

// Class mastery overview
router.get(
    '/class/:classId',
    authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
    asHandler(getClassMasteryOverview)
);

// Backfill (SUPERADMIN only)
router.post(
    '/backfill',
    authorizeRoles([UserRole.SUPERADMIN]),
    asHandler(backfillMastery)
);

export default router;
