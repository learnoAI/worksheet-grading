import Bull from 'bull';
import config from '../config/env';
import prisma from '../utils/prisma';
import { ProcessingStatus } from '@prisma/client';

// Create Bull queue for worksheet processing
const worksheetQueue = new Bull('worksheet-processing', config.redisUrl);

// Interface for the job data
interface WorksheetJobData {
    worksheetId: string;
}

// Process worksheets (mock OCR and grading process)
worksheetQueue.process(async (job) => {
    const { worksheetId } = job.data as WorksheetJobData;

    try {
        // Update status to PROCESSING
        await prisma.worksheet.update({
            where: { id: worksheetId },
            data: { status: ProcessingStatus.PROCESSING }
        });

        // Get all images for this worksheet
        const worksheetImages = await prisma.worksheetImage.findMany({
            where: { worksheetId },
            orderBy: { pageNumber: 'asc' }
        });

        if (worksheetImages.length === 0) {
            throw new Error('No images found for this worksheet');
        }

        // Simulate processing delay (3-5 seconds)
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 3000));

        // Mock OCR/grading result - processing multiple pages
        // In a real system, this would involve analyzing all pages
        const mockGrade = Math.floor(Math.random() * 100) / 10; // Random grade between 0 and 10

        // Update worksheet with result
        const worksheet = await prisma.worksheet.update({
            where: { id: worksheetId },
            data: {
                status: ProcessingStatus.COMPLETED,
                grade: mockGrade
            },
            include: {
                submittedBy: true,
                class: true
            }
        });

        // Create notification for the teacher
        await prisma.notification.create({
            data: {
                message: `Worksheet grading completed for class ${worksheet.class.name}. Grade: ${mockGrade}`,
                userId: worksheet.submittedById
            }
        });

        return { success: true, grade: mockGrade };
    } catch (error) {
        // Update status to FAILED
        await prisma.worksheet.update({
            where: { id: worksheetId },
            data: { status: ProcessingStatus.FAILED }
        });

        throw error;
    }
});

// Add job to queue
export const enqueueWorksheet = async (worksheetId: string): Promise<void> => {
    await worksheetQueue.add({ worksheetId });
};

// Handle failed jobs
worksheetQueue.on('failed', async (job, error) => {
    const { worksheetId } = job.data as WorksheetJobData;
    console.error(`Job failed for worksheet ${worksheetId}:`, error);

    // Update worksheet status
    await prisma.worksheet.update({
        where: { id: worksheetId },
        data: { status: ProcessingStatus.FAILED }
    });
});

export default worksheetQueue; 