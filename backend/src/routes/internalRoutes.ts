import express from 'express';
import { body } from 'express-validator';
import { storeGradingResult } from '../controllers/internalController';
import { asHandler } from '../middleware/utils';

const router = express.Router();

// Store grading result to Postgres (called by Worker with internal token)
router.post(
  '/store-grading-result',
  [
    body('jobId').notEmpty().withMessage('Job ID is required'),
    body('classId').notEmpty().withMessage('Class ID is required'),
    body('studentId').notEmpty().withMessage('Student ID is required'),
    body('worksheetNumber').isInt({ min: 1 }).withMessage('Worksheet number must be a positive integer'),
    body('grade').isNumeric().withMessage('Grade must be a number'),
    body('submittedOn').isISO8601().withMessage('Submitted date must be ISO 8601 format'),
    body('mongoDbId').notEmpty().withMessage('MongoDB ID is required'),
    body('gradingDetails').isObject().withMessage('Grading details must be an object')
  ],
  asHandler(storeGradingResult)
);

export default router;
