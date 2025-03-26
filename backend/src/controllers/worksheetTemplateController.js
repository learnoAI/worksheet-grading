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
exports.createMathSkill = exports.getAllMathSkills = exports.deleteTemplateQuestion = exports.updateTemplateQuestion = exports.addTemplateQuestion = exports.deleteTemplateImage = exports.addTemplateImage = exports.deleteWorksheetTemplate = exports.updateWorksheetTemplate = exports.createWorksheetTemplate = exports.getWorksheetTemplateById = exports.getAllWorksheetTemplates = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
/**
 * Get all worksheet templates
 * @route GET /api/worksheet-templates
 */
const getAllWorksheetTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templates = yield prisma_1.default.worksheetTemplate.findMany({
            include: {
                worksheetImages: true,
                questions: {
                    include: {
                        skills: true
                    }
                }
            }
        });
        return res.status(200).json(templates);
    }
    catch (error) {
        console.error('Error fetching worksheet templates:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheet templates' });
    }
});
exports.getAllWorksheetTemplates = getAllWorksheetTemplates;
/**
 * Get a specific worksheet template by ID
 * @route GET /api/worksheet-templates/:id
 */
const getWorksheetTemplateById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const template = yield prisma_1.default.worksheetTemplate.findUnique({
            where: { id },
            include: {
                worksheetImages: true,
                questions: {
                    include: {
                        skills: true
                    }
                }
            }
        });
        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }
        return res.status(200).json(template);
    }
    catch (error) {
        console.error('Error fetching worksheet template:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheet template' });
    }
});
exports.getWorksheetTemplateById = getWorksheetTemplateById;
/**
 * Create a new worksheet template
 * @route POST /api/worksheet-templates
 */
const createWorksheetTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { worksheetNumber } = req.body;
    try {
        // Check if the worksheet number already exists
        if (worksheetNumber) {
            const existingTemplate = yield prisma_1.default.worksheetTemplate.findUnique({
                where: { worksheetNumber: Number(worksheetNumber) }
            });
            if (existingTemplate) {
                return res.status(400).json({ message: 'A template with this worksheet number already exists' });
            }
        }
        // Create the new template
        const newTemplate = yield prisma_1.default.worksheetTemplate.create({
            data: {
                worksheetNumber: worksheetNumber ? Number(worksheetNumber) : undefined
            }
        });
        return res.status(201).json(newTemplate);
    }
    catch (error) {
        console.error('Error creating worksheet template:', error);
        return res.status(500).json({ message: 'Server error while creating worksheet template' });
    }
});
exports.createWorksheetTemplate = createWorksheetTemplate;
/**
 * Update a worksheet template
 * @route PUT /api/worksheet-templates/:id
 */
const updateWorksheetTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { worksheetNumber } = req.body;
    try {
        // Check if the template exists
        const existingTemplate = yield prisma_1.default.worksheetTemplate.findUnique({
            where: { id }
        });
        if (!existingTemplate) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }
        // Check if the new worksheet number already exists
        if (worksheetNumber && worksheetNumber !== existingTemplate.worksheetNumber) {
            const duplicateNumber = yield prisma_1.default.worksheetTemplate.findUnique({
                where: { worksheetNumber: Number(worksheetNumber) }
            });
            if (duplicateNumber) {
                return res.status(400).json({ message: 'A template with this worksheet number already exists' });
            }
        }
        // Update the template
        const updatedTemplate = yield prisma_1.default.worksheetTemplate.update({
            where: { id },
            data: {
                worksheetNumber: worksheetNumber ? Number(worksheetNumber) : null
            }
        });
        return res.status(200).json(updatedTemplate);
    }
    catch (error) {
        console.error('Error updating worksheet template:', error);
        return res.status(500).json({ message: 'Server error while updating worksheet template' });
    }
});
exports.updateWorksheetTemplate = updateWorksheetTemplate;
/**
 * Delete a worksheet template
 * @route DELETE /api/worksheet-templates/:id
 */
const deleteWorksheetTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        // Check if the template exists
        const template = yield prisma_1.default.worksheetTemplate.findUnique({
            where: { id }
        });
        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }
        // Delete all associated images and questions
        yield prisma_1.default.worksheetTemplateImage.deleteMany({
            where: { worksheetTemplateId: id }
        });
        // Delete the template
        yield prisma_1.default.worksheetTemplate.delete({
            where: { id }
        });
        return res.status(200).json({ message: 'Worksheet template deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting worksheet template:', error);
        return res.status(500).json({ message: 'Server error while deleting worksheet template' });
    }
});
exports.deleteWorksheetTemplate = deleteWorksheetTemplate;
/**
 * Add an image to a worksheet template
 * @route POST /api/worksheet-templates/:id/images
 */
const addTemplateImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { imageUrl, pageNumber } = req.body;
    try {
        // Check if the template exists
        const template = yield prisma_1.default.worksheetTemplate.findUnique({
            where: { id }
        });
        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }
        // Create the image
        const newImage = yield prisma_1.default.worksheetTemplateImage.create({
            data: {
                imageUrl,
                pageNumber: Number(pageNumber),
                worksheetTemplateId: id
            }
        });
        return res.status(201).json(newImage);
    }
    catch (error) {
        console.error('Error adding template image:', error);
        return res.status(500).json({ message: 'Server error while adding template image' });
    }
});
exports.addTemplateImage = addTemplateImage;
/**
 * Delete an image from a worksheet template
 * @route DELETE /api/worksheet-templates/images/:id
 */
const deleteTemplateImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        // Check if the image exists
        const image = yield prisma_1.default.worksheetTemplateImage.findUnique({
            where: { id }
        });
        if (!image) {
            return res.status(404).json({ message: 'Template image not found' });
        }
        // Delete the image
        yield prisma_1.default.worksheetTemplateImage.delete({
            where: { id }
        });
        return res.status(200).json({ message: 'Template image deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting template image:', error);
        return res.status(500).json({ message: 'Server error while deleting template image' });
    }
});
exports.deleteTemplateImage = deleteTemplateImage;
/**
 * Add a question to a worksheet template
 * @route POST /api/worksheet-templates/:id/questions
 */
const addTemplateQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { question, answer, outOf, skillIds } = req.body;
    try {
        // Check if the template exists
        const template = yield prisma_1.default.worksheetTemplate.findUnique({
            where: { id }
        });
        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }
        // Create the question
        const newQuestion = yield prisma_1.default.worksheetTemplateQuestion.create({
            data: {
                question,
                answer,
                outOf: outOf ? Number(outOf) : 1,
                worksheetTemplateId: id,
                worksheetTemplates: {
                    connect: { id }
                },
                skills: skillIds ? {
                    connect: skillIds.map((skillId) => ({ id: skillId }))
                } : undefined
            },
            include: {
                skills: true
            }
        });
        return res.status(201).json(newQuestion);
    }
    catch (error) {
        console.error('Error adding template question:', error);
        return res.status(500).json({ message: 'Server error while adding template question' });
    }
});
exports.addTemplateQuestion = addTemplateQuestion;
/**
 * Update a template question
 * @route PUT /api/worksheet-templates/questions/:id
 */
const updateTemplateQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { question, answer, outOf, skillIds } = req.body;
    try {
        // Check if the question exists
        const existingQuestion = yield prisma_1.default.worksheetTemplateQuestion.findUnique({
            where: { id },
            include: { skills: true }
        });
        if (!existingQuestion) {
            return res.status(404).json({ message: 'Template question not found' });
        }
        // Update the question
        const updatedQuestion = yield prisma_1.default.worksheetTemplateQuestion.update({
            where: { id },
            data: {
                question: question || undefined,
                answer: answer || undefined,
                outOf: outOf ? Number(outOf) : undefined,
                skills: skillIds ? {
                    set: skillIds.map((skillId) => ({ id: skillId }))
                } : undefined
            },
            include: {
                skills: true
            }
        });
        return res.status(200).json(updatedQuestion);
    }
    catch (error) {
        console.error('Error updating template question:', error);
        return res.status(500).json({ message: 'Server error while updating template question' });
    }
});
exports.updateTemplateQuestion = updateTemplateQuestion;
/**
 * Delete a template question
 * @route DELETE /api/worksheet-templates/questions/:id
 */
const deleteTemplateQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        // Check if the question exists
        const question = yield prisma_1.default.worksheetTemplateQuestion.findUnique({
            where: { id }
        });
        if (!question) {
            return res.status(404).json({ message: 'Template question not found' });
        }
        // Delete the question
        yield prisma_1.default.worksheetTemplateQuestion.delete({
            where: { id }
        });
        return res.status(200).json({ message: 'Template question deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting template question:', error);
        return res.status(500).json({ message: 'Server error while deleting template question' });
    }
});
exports.deleteTemplateQuestion = deleteTemplateQuestion;
/**
 * Get all math skills
 * @route GET /api/math-skills
 */
const getAllMathSkills = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const skills = yield prisma_1.default.mathSkill.findMany();
        return res.status(200).json(skills);
    }
    catch (error) {
        console.error('Error fetching math skills:', error);
        return res.status(500).json({ message: 'Server error while retrieving math skills' });
    }
});
exports.getAllMathSkills = getAllMathSkills;
/**
 * Create a new math skill
 * @route POST /api/math-skills
 */
const createMathSkill = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { name, description } = req.body;
    try {
        const newSkill = yield prisma_1.default.mathSkill.create({
            data: {
                name,
                description
            }
        });
        return res.status(201).json(newSkill);
    }
    catch (error) {
        console.error('Error creating math skill:', error);
        return res.status(500).json({ message: 'Server error while creating math skill' });
    }
});
exports.createMathSkill = createMathSkill;
