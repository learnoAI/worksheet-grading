import express from 'express';
import { body, query } from 'express-validator';
import { auth, authorizeRoles } from '../middleware/utils';
import { asHandler } from '../middleware/utils';
import { UserRole } from '@prisma/client';
import multer from 'multer';
import { processWorksheets, createGradedWorksheetWithMongoId } from '../controllers/worksheetProcessingController';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept only images
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Process worksheets through Python API
router.post(
    '/process',
    [
        upload.array('files', 10), // Allow up to 10 images with field name 'files'
        body('token_no').notEmpty().withMessage('Token number is required'),
        body('worksheet_name').notEmpty().withMessage('Worksheet name is required')
    ],
    asHandler(processWorksheets)
);

// Create graded worksheet with MongoDB ID
router.post(
    '/grade-with-mongo-id',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        body('classId').notEmpty().withMessage('Class ID is required'),
        body('studentId').notEmpty().withMessage('Student ID is required'),
        body('worksheetNumber').isInt({ min: 0 }).withMessage('Valid worksheet number is required'),
        body('grade').isFloat({ min: 0, max: 40 }).withMessage('Valid grade between 0 and 40 is required'),
        body('submittedOn').notEmpty().withMessage('Submission date is required'),
        body('mongoDbId').optional()
    ],
    asHandler(createGradedWorksheetWithMongoId)
);

export default router;
