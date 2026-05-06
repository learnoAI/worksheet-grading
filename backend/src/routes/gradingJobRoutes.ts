import express from 'express';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';
import {
    getTeacherJobsToday,
    getJobsByClass,
    getJobStatus,
    getBatchJobStatus,
    getAdminGradingJobsDashboard
} from '../controllers/gradingJobController';
import { UserRole } from '@prisma/client';

const router = express.Router();

// Get teacher's jobs for today
router.get('/teacher/today', auth, asHandler(getTeacherJobsToday));

// Superadmin grading jobs dashboard
router.get('/admin/dashboard', auth, authorizeRoles([UserRole.SUPERADMIN]), asHandler(getAdminGradingJobsDashboard));

// Get jobs by class and date
router.get('/class/:classId', auth, asHandler(getJobsByClass));

// Get single job status
router.get('/:jobId', auth, asHandler(getJobStatus));

// Get multiple job statuses (for polling)
router.post('/batch-status', auth, asHandler(getBatchJobStatus));

export default router;
