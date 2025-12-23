import express from 'express';
import { auth, asHandler } from '../middleware/utils';
import {
    getTeacherJobsToday,
    getJobsByClass,
    getJobStatus,
    getBatchJobStatus
} from '../controllers/gradingJobController';

const router = express.Router();

// Get teacher's jobs for today
router.get('/teacher/today', auth, asHandler(getTeacherJobsToday));

// Get jobs by class and date
router.get('/class/:classId', auth, asHandler(getJobsByClass));

// Get single job status
router.get('/:jobId', auth, asHandler(getJobStatus));

// Get multiple job statuses (for polling)
router.post('/batch-status', auth, asHandler(getBatchJobStatus));

export default router;
