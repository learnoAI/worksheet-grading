import express from 'express';
import multer from 'multer';
import { body, query } from 'express-validator';
import {
    uploadWorksheet,
    getWorksheetsByClass,
    getWorksheetsByStudent,
    getWorksheetById,
    getTeacherClasses,
    getClassStudents,
    getWorksheetTemplates,
    createGradedWorksheet,
    findWorksheetByClassStudentDate,
    updateGradedWorksheet,
    deleteGradedWorksheet,
    getPreviousWorksheets
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

// Find worksheet by class, student, and date
router.get(
    '/find',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        query('classId').notEmpty().withMessage('Class ID is required'),
        query('studentId').notEmpty().withMessage('Student ID is required'),
        query('startDate').isISO8601().withMessage('Start date must be a valid ISO date'),
        query('endDate').isISO8601().withMessage('End date must be a valid ISO date')
    ],
    asHandler(findWorksheetByClassStudentDate)
);

// Get worksheets by class
router.get('/class/:classId', auth, asHandler(getWorksheetsByClass));

// Get worksheets by student
router.get('/student/:studentId', auth, asHandler(getWorksheetsByStudent));

// Get previous worksheets for a student up to a specific date
router.get(
    '/history',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        query('classId').notEmpty().withMessage('Class ID is required'),
        query('studentId').notEmpty().withMessage('Student ID is required'),
        query('endDate').isISO8601().withMessage('End date must be a valid ISO date')
    ],
    asHandler(getPreviousWorksheets)
);

// Get worksheet by ID
router.get('/:id', auth, asHandler(getWorksheetById));

// Get classes for a teacher
router.get(
    '/teacher/:teacherId/classes',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN])
    ],
    asHandler(getTeacherClasses)
);

// Get students in a class
router.get(
    '/class/:classId/students',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN])
    ],
    asHandler(getClassStudents)
);

// Get worksheet templates
router.get(
    '/templates',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN])
    ],
    asHandler(getWorksheetTemplates)
);

// Create a graded worksheet
router.post(
    '/grade',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        body('classId').notEmpty().withMessage('Class ID is required'),
        body('studentId').notEmpty().withMessage('Student ID is required'),
        body('worksheetNumber').custom((value, { req }) => {
            // Allow worksheetNumber to be 0 for absent students
            if (req.body.isAbsent) {
                return true; // No validation for absent students
            }
            // For non-absent students, require positive integer
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error('Worksheet number must be a positive integer for non-absent students');
            }
            return true;
        }),
        body('grade').custom((value, { req }) => {
            // Allow grade to be 0 for absent students
            if (req.body.isAbsent) {
                return true; // No validation for absent students
            }
            // For non-absent students, validate range
            const numValue = parseFloat(value);
            if (isNaN(numValue) || numValue < 0 || numValue > 40) {
                throw new Error('Grade must be between 0 and 40 for non-absent students');
            }
            return true;
        }),
        body('notes').optional(),
        body('submittedOn').optional().isISO8601().withMessage('Submitted date must be a valid ISO date'),
        body('isAbsent').optional().isBoolean(),
        body('isRepeated').optional().isBoolean(),
        body('isIncorrectGrade').optional().isBoolean()
    ],
    asHandler(createGradedWorksheet)
);

// Update a graded worksheet
router.put(
    '/grade/:id',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        body('classId').notEmpty().withMessage('Class ID is required'),
        body('studentId').notEmpty().withMessage('Student ID is required'),
        body('worksheetNumber').custom((value, { req }) => {
            // Allow worksheetNumber to be 0 for absent students
            if (req.body.isAbsent) {
                return true; // No validation for absent students
            }
            // For non-absent students, require positive integer
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error('Worksheet number must be a positive integer for non-absent students');
            }
            return true;
        }),
        body('grade').custom((value, { req }) => {
            // Allow grade to be 0 for absent students
            if (req.body.isAbsent) {
                return true; // No validation for absent students
            }
            // For non-absent students, validate range
            const numValue = parseFloat(value);
            if (isNaN(numValue) || numValue < 0 || numValue > 40) {
                throw new Error('Grade must be between 0 and 40 for non-absent students');
            }
            return true;
        }),
        body('notes').optional(),
        body('submittedOn').optional().isISO8601().withMessage('Submitted date must be a valid ISO date'),
        body('isAbsent').optional().isBoolean(),
        body('isRepeated').optional().isBoolean(),
        body('isIncorrectGrade').optional().isBoolean()
    ],
    asHandler(updateGradedWorksheet)
);

// Delete a graded worksheet
router.delete(
    '/:id',
    [auth, authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN])],
    asHandler(deleteGradedWorksheet)
);

export default router; 