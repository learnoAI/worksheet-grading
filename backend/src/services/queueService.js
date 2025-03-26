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
exports.enqueueWorksheet = void 0;
const bull_1 = __importDefault(require("bull"));
const env_1 = __importDefault(require("../config/env"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const client_1 = require("@prisma/client");
// Create Bull queue for worksheet processing
const worksheetQueue = new bull_1.default('worksheet-processing', env_1.default.redisUrl);
// Process worksheets (mock OCR and grading process)
worksheetQueue.process((job) => __awaiter(void 0, void 0, void 0, function* () {
    const { worksheetId } = job.data;
    try {
        // Update status to PROCESSING
        yield prisma_1.default.worksheet.update({
            where: { id: worksheetId },
            data: { status: client_1.ProcessingStatus.PROCESSING }
        });
        // Get all images for this worksheet
        const worksheetImages = yield prisma_1.default.worksheetImage.findMany({
            where: { worksheetId },
            orderBy: { pageNumber: 'asc' }
        });
        if (worksheetImages.length === 0) {
            throw new Error('No images found for this worksheet');
        }
        // Simulate processing delay (3-5 seconds)
        yield new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 3000));
        // Mock OCR/grading result - processing multiple pages
        // In a real system, this would involve analyzing all pages
        const mockGrade = Math.floor(Math.random() * 100) / 10; // Random grade between 0 and 10
        // Update worksheet with result
        const worksheet = yield prisma_1.default.worksheet.update({
            where: { id: worksheetId },
            data: {
                status: client_1.ProcessingStatus.COMPLETED,
                grade: mockGrade
            },
            include: {
                submittedBy: true,
                class: true
            }
        });
        // Create notification for the teacher
        yield prisma_1.default.notification.create({
            data: {
                message: `Worksheet grading completed for class ${worksheet.class.name}. Grade: ${mockGrade}/10`,
                userId: worksheet.submittedById
            }
        });
        return { success: true, grade: mockGrade };
    }
    catch (error) {
        // Update status to FAILED
        yield prisma_1.default.worksheet.update({
            where: { id: worksheetId },
            data: { status: client_1.ProcessingStatus.FAILED }
        });
        throw error;
    }
}));
// Add job to queue
const enqueueWorksheet = (worksheetId) => __awaiter(void 0, void 0, void 0, function* () {
    yield worksheetQueue.add({ worksheetId });
});
exports.enqueueWorksheet = enqueueWorksheet;
// Handle failed jobs
worksheetQueue.on('failed', (job, error) => __awaiter(void 0, void 0, void 0, function* () {
    const { worksheetId } = job.data;
    console.error(`Job failed for worksheet ${worksheetId}:`, error);
    // Update worksheet status
    yield prisma_1.default.worksheet.update({
        where: { id: worksheetId },
        data: { status: client_1.ProcessingStatus.FAILED }
    });
}));
exports.default = worksheetQueue;
