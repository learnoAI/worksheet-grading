import express from 'express';
import multer from 'multer';
import { body } from 'express-validator';
import {
    uploadWorksheet,
    getWorksheetsByClass,
    getWorksheetsByStudent,
    getWorksheetById
} from '../controllers/worksheetController';
import { UserRole } from '@prisma/client';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

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

// Upload worksheet (teachers, admins, superadmins)
router.post(
    '/upload',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        upload.array('images', 10), // Allow up to 10 images with field name 'images'
        body('classId').notEmpty().withMessage('Class ID is required'),
        body('studentId').optional(),
        body('notes').optional(),
        body('pageNumbers.*').optional().isInt({ min: 1 }).withMessage('Page numbers must be positive integers')
    ],
    asHandler(uploadWorksheet)
);

// Get worksheets by class
router.get('/class/:classId', auth, asHandler(getWorksheetsByClass));

// Get worksheets by student
router.get('/student/:studentId', auth, asHandler(getWorksheetsByStudent));

// Get worksheet by ID
router.get('/:id', auth, asHandler(getWorksheetById));

export default router; 