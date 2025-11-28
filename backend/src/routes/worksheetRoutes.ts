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
    findAllWorksheetsByClassStudentDate,
    updateGradedWorksheet,
    deleteGradedWorksheet,
    getPreviousWorksheets,
    getIncorrectGradingWorksheets,
    updateWorksheetAdminComments,
    markWorksheetAsCorrectlyGraded,
    getWorksheetImages,
    getTotalAiGraded,
    getStudentGradingDetails
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

// Find ALL worksheets by class, student, and date (for multiple worksheets per day)
router.get(
    '/find-all',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        query('classId').notEmpty().withMessage('Class ID is required'),
        query('studentId').notEmpty().withMessage('Student ID is required'),
        query('startDate').isISO8601().withMessage('Start date must be a valid ISO date'),
        query('endDate').isISO8601().withMessage('End date must be a valid ISO date')
    ],
    asHandler(findAllWorksheetsByClassStudentDate)
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

// Get worksheets flagged as incorrectly graded (superadmin only)
router.get(
    '/incorrect-grading',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        query('page').optional().isInt({ min: 1 }).withMessage('page must be >= 1'),
        query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('pageSize must be between 1 and 100'),
        query('startDate').optional().isISO8601().withMessage('startDate must be a valid ISO date'),
        query('endDate').optional().isISO8601().withMessage('endDate must be a valid ISO date')
    ],
    asHandler(getIncorrectGradingWorksheets)
);

// Update worksheet admin comments (superadmin only)
router.patch(
    '/:id/admin-comments',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('adminComments').optional().isString().withMessage('Admin comments must be a string')
    ],
    asHandler(updateWorksheetAdminComments)
);

// Mark worksheet as correctly graded (superadmin only)
router.patch(
    '/:id/mark-correct',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN])
    ],
    asHandler(markWorksheetAsCorrectlyGraded)
);

// Get worksheet images via Python API
router.post(
    '/images',
    [
        auth,
        authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
        body('token_no').notEmpty().withMessage('Token number is required'),
        body('worksheet_name').notEmpty().withMessage('Worksheet name is required')
    ],
    asHandler(getWorksheetImages)
);

// Get total AI graded worksheets count via Python API
router.post(
    '/total-ai-graded',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN])
    ],
    asHandler(getTotalAiGraded)
);

// Get student grading details via Python API
router.post(
    '/student-grading-details',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('token_no').notEmpty().withMessage('Token number is required'),
        body('worksheet_name').notEmpty().withMessage('Worksheet name is required'),
        body('overall_score').optional().isNumeric().withMessage('Overall score must be a number')
    ],
    asHandler(getStudentGradingDetails)
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