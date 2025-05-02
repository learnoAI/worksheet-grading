"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGradedWorksheet = exports.findWorksheetByClassStudentDate = exports.createGradedWorksheet = exports.getWorksheetTemplates = exports.getClassStudents = exports.getTeacherClasses = exports.getWorksheetById = exports.getWorksheetsByStudent = exports.getWorksheetsByClass = exports.uploadWorksheet = void 0;
const express_validator_1 = require("express-validator");
const prisma_1 = __importDefault(require("../utils/prisma"));
const s3Service_1 = require("../services/s3Service");
const queueService_1 = require("../services/queueService");
const client_1 = require("@prisma/client");
/**
 * Upload a worksheet with multiple images
 * @route POST /api/worksheets/upload
 */
const uploadWorksheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // Validate input
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    // Check if files were uploaded
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
    }
    const { classId, studentId, notes } = req.body;
    // Access files array directly
    const files = req.files;
    try {
        // Check if class exists
        const classExists = yield prisma_1.default.class.findUnique({
            where: { id: classId }
        });
        if (!classExists) {
            return res.status(404).json({ message: 'Class not found' });
        }
        // If studentId is provided, check if student exists
        if (studentId) {
            const student = yield prisma_1.default.user.findFirst({
                where: {
                    id: studentId,
                    role: 'STUDENT',
                    studentClasses: {
                        some: {
                            classId
                        }
                    }
                }
            });
            if (!student) {
                return res.status(404).json({ message: 'Student not found in this class' });
            }
        }
        // Create worksheet record
        const worksheet = yield prisma_1.default.worksheet.create({
            data: {
                notes: notes || null,
                status: client_1.ProcessingStatus.PENDING,
                submittedById: req.user.userId,
                classId,
                studentId: studentId || null
            }
        });
        // Upload each file to S3 and create WorksheetImage records
        const imagePromises = files.map((file, index) => __awaiter(void 0, void 0, void 0, function* () {
            // Get page number from the request or use the index
            const pageNumber = req.body.pageNumbers && Array.isArray(req.body.pageNumbers) ?
                parseInt(req.body.pageNumbers[index]) :
                index + 1;
            // Generate unique filename
            const timestamp = Date.now();
            const filename = `worksheets/${worksheet.id}/${timestamp}-page${pageNumber}-${file.originalname.replace(/\s+/g, '_')}`;
            // Upload to S3
            const imageUrl = yield (0, s3Service_1.uploadToS3)(file.buffer, filename, file.mimetype);
            // Create WorksheetImage record
            return prisma_1.default.worksheetImage.create({
                data: {
                    imageUrl,
                    pageNumber,
                    worksheetId: worksheet.id
                }
            });
        }));
        // Wait for all images to be uploaded and records created
        const worksheetImages = yield Promise.all(imagePromises);
        // Enqueue for processing
        yield (0, queueService_1.enqueueWorksheet)(worksheet.id);
        return res.status(201).json({
            id: worksheet.id,
            images: worksheetImages,
            status: worksheet.status,
            message: 'Worksheet uploaded and queued for processing'
        });
    }
    catch (error) {
        console.error('Worksheet upload error:', error);
        return res.status(500).json({ message: 'Server error during worksheet upload' });
    }
});
exports.uploadWorksheet = uploadWorksheet;
/**
 * Get all worksheets for a class
 * @route GET /api/worksheets/class/:classId
 */
const getWorksheetsByClass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { classId } = req.params;
    try {
        const worksheets = yield prisma_1.default.worksheet.findMany({
            where: { classId },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                images: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        return res.status(200).json(worksheets);
    }
    catch (error) {
        console.error('Get worksheets by class error:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheets' });
    }
});
exports.getWorksheetsByClass = getWorksheetsByClass;
/**
 * Get all worksheets for a student
 * @route GET /api/worksheets/student/:studentId
 */
const getWorksheetsByStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { studentId } = req.params;
    try {
        // First check if student exists
        const student = yield prisma_1.default.user.findFirst({
            where: {
                id: studentId,
                role: 'STUDENT'
            }
        });
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        const worksheets = yield prisma_1.default.worksheet.findMany({
            where: { studentId },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                template: {
                    select: {
                        id: true,
                        worksheetNumber: true
                    }
                },
                images: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        return res.status(200).json(worksheets);
    }
    catch (error) {
        console.error('Get worksheets by student error:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheets' });
    }
});
exports.getWorksheetsByStudent = getWorksheetsByStudent;
/**
 * Get a specific worksheet by ID
 * @route GET /api/worksheets/:id
 */
const getWorksheetById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const worksheet = yield prisma_1.default.worksheet.findUnique({
            where: { id },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                images: true
            }
        });
        if (!worksheet) {
            return res.status(404).json({ message: 'Worksheet not found' });
        }
        return res.status(200).json(worksheet);
    }
    catch (error) {
        console.error('Get worksheet by ID error:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheet' });
    }
});
exports.getWorksheetById = getWorksheetById;
// Get classes for a teacher
const getTeacherClasses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { teacherId } = req.params;
    const classes = yield prisma_1.default.teacherClass.findMany({
        where: {
            teacherId: teacherId
        },
        include: {
            class: {
                include: {
                    school: true
                }
            }
        }
    });
    // Transform the data to match the frontend's needs
    const transformedClasses = classes.map(tc => ({
        id: tc.class.id,
        name: `${tc.class.school.name} - ${tc.class.name}`,
    }));
    res.json(transformedClasses);
});
exports.getTeacherClasses = getTeacherClasses;
// Get students in a class
const getClassStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { classId } = req.params;
    const students = yield prisma_1.default.studentClass.findMany({
        where: {
            classId: classId
        },
        include: {
            student: {
                select: {
                    id: true,
                    username: true,
                    name: true,
                    tokenNumber: true
                }
            }
        }
    });
    // Transform the data to match the frontend's needs
    const transformedStudents = students.map(sc => ({
        id: sc.student.id,
        username: sc.student.username,
        name: sc.student.name,
        tokenNumber: sc.student.tokenNumber
    }));
    res.json(transformedStudents);
});
exports.getClassStudents = getClassStudents;
// Get worksheet templates
const getWorksheetTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const templates = yield prisma_1.default.worksheetTemplate.findMany({
        select: {
            id: true,
            worksheetNumber: true
        },
        orderBy: {
            worksheetNumber: 'asc'
        }
    });
    res.json(templates);
});
exports.getWorksheetTemplates = getWorksheetTemplates;
// Create a graded worksheet
const createGradedWorksheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { classId, studentId, worksheetNumber, grade, notes, submittedOn, isAbsent, isRepeated } = req.body;
    const submittedById = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
    try {
        // If student is absent, create a record marking them as absent
        if (isAbsent) {
            const worksheet = yield prisma_1.default.worksheet.create({
                data: {
                    classId,
                    studentId,
                    grade: 0, // Default grade for absent student
                    notes: notes || 'Student absent',
                    submittedById: submittedById,
                    status: client_1.ProcessingStatus.COMPLETED,
                    outOf: 40,
                    templateId: null, // Explicitly set to null for absent students
                    submittedOn: submittedOn ? new Date(submittedOn) : undefined,
                    isAbsent: true,
                    isRepeated: false,
                }
            });

            return res.status(201).json(worksheet);
        }
        
        // Find the template by worksheet number for non-absent students
        const template = yield prisma_1.default.worksheetTemplate.findFirst({
            where: {
                worksheetNumber
            }
        });
        if (!template) {
            return res.status(404).json({ message: `No template found for worksheet number ${worksheetNumber}` });
        }
        const worksheet = yield prisma_1.default.worksheet.create({
            data: {
                classId,
                studentId,
                templateId: template.id,
                grade,
                notes,
                submittedById: submittedById,
                status: client_1.ProcessingStatus.COMPLETED,
                outOf: 40,
                submittedOn: submittedOn ? new Date(submittedOn) : undefined,
                isAbsent: false,
                isRepeated: isRepeated || false,
            }
        });
        res.status(201).json(worksheet);
    }
    catch (error) {
        console.error('Create graded worksheet error:', error);
        return res.status(500).json({ message: 'Server error while creating worksheet' });
    }
});
exports.createGradedWorksheet = createGradedWorksheet;
// Find worksheet by class, student, and date range
const findWorksheetByClassStudentDate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { classId, studentId, startDate, endDate } = req.query;
    if (!classId || !studentId || !startDate || !endDate) {
        return res.status(400).json({ message: 'Missing required query parameters' });
    }
    try {
        const worksheet = yield prisma_1.default.worksheet.findFirst({
            where: {
                classId: classId,
                studentId: studentId,
                submittedOn: {
                    gte: new Date(startDate),
                    lt: new Date(endDate)
                }
            },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                template: true
            }
        });
        return res.status(200).json(worksheet);
    }
    catch (error) {
        console.error('Find worksheet error:', error);
        return res.status(500).json({ message: 'Server error while finding worksheet' });
    }
});
exports.findWorksheetByClassStudentDate = findWorksheetByClassStudentDate;
// Update a graded worksheet
const updateGradedWorksheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id } = req.params;
    const { classId, studentId, worksheetNumber, grade, notes, submittedOn, isAbsent, isRepeated } = req.body;
    console.log('Update worksheet request:', req.body);
    const submittedById = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
    try {
        // Find the existing worksheet
        const existingWorksheet = yield prisma_1.default.worksheet.findUnique({
            where: { id }
        });
        if (!existingWorksheet) {
            return res.status(404).json({ message: 'No worksheet found to update' });
        }
        
        // If student is marked as absent - handle specially without requiring a template
        if (isAbsent) {
            console.log('Marking student as absent - clearing all grade data');
            const worksheet = yield prisma_1.default.worksheet.update({
                where: { id },
                data: {
                    classId,
                    studentId,
                    grade: 0, // Force zero grade for absent student
                    notes: notes || 'Student absent',
                    submittedById: submittedById,
                    status: client_1.ProcessingStatus.COMPLETED,
                    outOf: 40,
                    templateId: null, // No template needed for absent students
                    submittedOn: submittedOn ? new Date(submittedOn) : undefined,
                    isAbsent: true,
                    isRepeated: false // Can't be repeated if absent
                }
            });
            
            return res.status(200).json(worksheet);
        }

        // Handle non-absent case
        // Find the template by worksheet number
        const template = yield prisma_1.default.worksheetTemplate.findFirst({
            where: {
                worksheetNumber: worksheetNumber
            }
        });
        if (!template) {
            return res.status(404).json({ message: `No template found for worksheet number ${worksheetNumber}` });
        }
        
        const data = {
            classId,
            studentId,
            grade,
            notes,
            submittedById: submittedById,
            status: client_1.ProcessingStatus.COMPLETED,
            outOf: 40,
            templateId: template.id,
            submittedOn: submittedOn ? new Date(submittedOn) : undefined,
            isAbsent: false,
            isRepeated: isRepeated || false
        };
        
        const worksheet = yield prisma_1.default.worksheet.update({
            where: { id },
            data
        });
        
        res.status(200).json(worksheet);
    }
    catch (error) {
        console.error('Update graded worksheet error:', error);
        return res.status(500).json({ message: 'Server error while updating worksheet' });
    }
});
exports.updateGradedWorksheet = updateGradedWorksheet;
