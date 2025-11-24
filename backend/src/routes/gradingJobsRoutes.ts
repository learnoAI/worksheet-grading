import express from 'express';
import multer from 'multer';
import { body, param, query } from 'express-validator';
import {
  createGradingJob,
  createBatchGradingJobs,
  getJobStatus,
  getBatchStatus,
  getJobsByClass
} from '../controllers/gradingJobsController';
import { auth, asHandler } from '../middleware/utils';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Create single grading job
router.post(
  '/create',
  [
    auth,
    upload.array('files', 10), // Allow up to 10 files
    body('tokenNo').notEmpty().withMessage('Token number is required'),
    body('worksheetName').notEmpty().withMessage('Worksheet name is required'),
    body('studentId').notEmpty().withMessage('Student ID is required'),
    body('studentName').notEmpty().withMessage('Student name is required'),
    body('classId').notEmpty().withMessage('Class ID is required'),
    body('submittedOn').isISO8601().withMessage('Submitted date must be ISO 8601 format'),
    body('worksheetNumber').isInt({ min: 1 }).withMessage('Worksheet number must be a positive integer'),
    body('isRepeated').optional().isBoolean(),
    body('isCorrectGrade').optional().isBoolean(),
    body('isIncorrectGrade').optional().isBoolean()
  ],
  asHandler(createGradingJob)
);

// Create batch grading jobs
router.post(
  '/create-batch',
  [
    auth,
    body('jobs').isArray({ min: 1 }).withMessage('Jobs array is required'),
    body('classId').notEmpty().withMessage('Class ID is required'),
    body('submittedOn').isISO8601().withMessage('Submitted date must be ISO 8601 format')
  ],
  asHandler(createBatchGradingJobs)
);

// Get job status
router.get(
  '/status/:jobId',
  [
    auth,
    param('jobId').notEmpty().withMessage('Job ID is required')
  ],
  asHandler(getJobStatus)
);

// Get batch status
router.get(
  '/batch/:batchId',
  [
    auth,
    param('batchId').notEmpty().withMessage('Batch ID is required')
  ],
  asHandler(getBatchStatus)
);

// Get jobs by class and date
router.get(
  '/by-class/:classId',
  [
    auth,
    param('classId').notEmpty().withMessage('Class ID is required'),
    query('date').notEmpty().withMessage('Date query parameter is required')
  ],
  asHandler(getJobsByClass)
);

export default router;
