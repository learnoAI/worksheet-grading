import express from 'express';
import {
    getOverallAnalytics,
    getStudentAnalytics,
    downloadStudentAnalytics,
    getAllSchools,
    getClassesBySchool,
    removeStudentFromClass,
    addStudentToClass
} from '../controllers/analyticsController';
import { UserRole } from '@prisma/client';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

// Protect all analytics routes for SuperAdmin only
router.use(auth);
router.use(authorizeRoles([UserRole.SUPERADMIN]));

// Overall analytics
router.get('/overall', asHandler(getOverallAnalytics));

// Student analytics
router.get('/students', asHandler(getStudentAnalytics));
router.get('/students/download', asHandler(downloadStudentAnalytics));

// School and class data for filtering
router.get('/schools', asHandler(getAllSchools));
router.get('/schools/:schoolId/classes', asHandler(getClassesBySchool));

// Student class management
router.delete('/students/:studentId/classes/:classId', asHandler(removeStudentFromClass));
router.post('/students/:studentId/classes/:classId', asHandler(addStudentToClass));

export default router;