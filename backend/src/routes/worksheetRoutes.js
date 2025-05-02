"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const express_validator_1 = require("express-validator");
const worksheetController_1 = require("../controllers/worksheetController");
const client_1 = require("@prisma/client");
const utils_1 = require("../middleware/utils");
const router = express_1.default.Router();
// Configure multer for memory storage
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept only images
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    }
});
// Upload worksheet (teachers, admins, superadmins)
router.post('/upload', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.TEACHER, client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN]),
    upload.array('images', 10), // Allow up to 10 images with field name 'images'
    (0, express_validator_1.body)('classId').notEmpty().withMessage('Class ID is required'),
    (0, express_validator_1.body)('studentId').optional(),
    (0, express_validator_1.body)('notes').optional(),
    (0, express_validator_1.body)('pageNumbers.*').optional().isInt({ min: 1 }).withMessage('Page numbers must be positive integers')
], (0, utils_1.asHandler)(worksheetController_1.uploadWorksheet));
// Find worksheet by class, student, and date
router.get('/find', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.TEACHER, client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.query)('classId').notEmpty().withMessage('Class ID is required'),
    (0, express_validator_1.query)('studentId').notEmpty().withMessage('Student ID is required'),
    (0, express_validator_1.query)('startDate').isISO8601().withMessage('Start date must be a valid ISO date'),
    (0, express_validator_1.query)('endDate').isISO8601().withMessage('End date must be a valid ISO date')
], (0, utils_1.asHandler)(worksheetController_1.findWorksheetByClassStudentDate));
// Get worksheets by class
router.get('/class/:classId', utils_1.auth, (0, utils_1.asHandler)(worksheetController_1.getWorksheetsByClass));
// Get worksheets by student
router.get('/student/:studentId', utils_1.auth, (0, utils_1.asHandler)(worksheetController_1.getWorksheetsByStudent));
// Get worksheet by ID
router.get('/:id', utils_1.auth, (0, utils_1.asHandler)(worksheetController_1.getWorksheetById));
// Get classes for a teacher
router.get('/teacher/:teacherId/classes', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.TEACHER, client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN])
], (0, utils_1.asHandler)(worksheetController_1.getTeacherClasses));
// Get students in a class
router.get('/class/:classId/students', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.TEACHER, client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN])
], (0, utils_1.asHandler)(worksheetController_1.getClassStudents));
// Get worksheet templates
router.get('/templates', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.TEACHER, client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN])
], (0, utils_1.asHandler)(worksheetController_1.getWorksheetTemplates));
// Create a graded worksheet
router.post('/grade', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.TEACHER, client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('classId').notEmpty().withMessage('Class ID is required'),
    (0, express_validator_1.body)('studentId').notEmpty().withMessage('Student ID is required'),
    (0, express_validator_1.body)('worksheetNumber').custom((value, { req }) => {
        // If student is absent, worksheet number is not required
        if (req.body.isAbsent) {
            return true;
        }
        // Otherwise, it must be a positive integer
        if (!Number.isInteger(Number(value)) || Number(value) < 1) {
            throw new Error('Worksheet number must be a positive integer');
        }
        return true;
    }),
    (0, express_validator_1.body)('grade').isFloat({ min: 0, max: 10 }).withMessage('Grade must be between 0 and 10'),
    (0, express_validator_1.body)('notes').optional(),
    (0, express_validator_1.body)('submittedOn').optional().isISO8601().withMessage('Submitted date must be a valid ISO date')
], (0, utils_1.asHandler)(worksheetController_1.createGradedWorksheet));
// Update a graded worksheet
router.put('/grade/:id', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.TEACHER, client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('classId').notEmpty().withMessage('Class ID is required'),
    (0, express_validator_1.body)('studentId').notEmpty().withMessage('Student ID is required'),
    (0, express_validator_1.body)('worksheetNumber').custom((value, { req }) => {
        // If student is absent, worksheet number is not required
        if (req.body.isAbsent) {
            return true;
        }
        // Otherwise, it must be a positive integer
        if (!Number.isInteger(Number(value)) || Number(value) < 1) {
            throw new Error('Worksheet number must be a positive integer');
        }
        return true;
    }),
    (0, express_validator_1.body)('grade').isFloat({ min: 0, max: 10 }).withMessage('Grade must be between 0 and 10'),
    (0, express_validator_1.body)('notes').optional(),
    (0, express_validator_1.body)('submittedOn').optional().isISO8601().withMessage('Submitted date must be a valid ISO date')
], (0, utils_1.asHandler)(worksheetController_1.updateGradedWorksheet));
exports.default = router;
