import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { ProcessingStatus } from '@prisma/client';
import kvService from '../services/cloudflareKV';
import { StoreGradingResultRequest, GradingJob } from '../types/gradingJob';

// Store grading result to Postgres (called by Worker)
export const storeGradingResult = async (req: Request, res: Response) => {
  try {
    // Verify internal token
    const internalToken = req.headers['x-internal-token'];
    if (internalToken !== process.env.INTERNAL_API_TOKEN) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid internal token'
      });
    }

    const {
      jobId,
      classId,
      studentId,
      submittedById,
      worksheetNumber,
      grade,
      submittedOn,
      isRepeated,
      isCorrectGrade,
      isIncorrectGrade,
      mongoDbId,
      gradingDetails
    }: StoreGradingResultRequest = req.body;

    // Validation
    if (!jobId || !classId || !studentId || !worksheetNumber || grade === undefined || !submittedOn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Convert worksheetNumber to integer (in case it comes as string)
    const worksheetNum = typeof worksheetNumber === 'string' ? parseInt(worksheetNumber, 10) : worksheetNumber;

    // Find or create worksheet template
    let template = await prisma.worksheetTemplate.findFirst({
      where: { worksheetNumber: worksheetNum }
    });

    if (!template) {
      // Create template if it doesn't exist
      template = await prisma.worksheetTemplate.create({
        data: {
          worksheetNumber: worksheetNum
        }
      });
    }

    // Helper function to convert string booleans to actual booleans
    const toBoolean = (value: any): boolean => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.toLowerCase() === 'true';
      return Boolean(value);
    };

    // Create worksheet in Postgres
    const worksheet = await prisma.worksheet.create({
      data: {
        classId,
        studentId,
        submittedById: submittedById || 'system',
        templateId: template.id,
        grade: typeof grade === 'string' ? parseFloat(grade) : grade,
        outOf: gradingDetails?.total_possible || 40,
        notes: 'Auto-graded via background job',
        status: ProcessingStatus.COMPLETED,
        submittedOn: new Date(submittedOn),
        isAbsent: false,
        isRepeated: isRepeated !== undefined ? toBoolean(isRepeated) : false,
        isCorrectGrade: isCorrectGrade !== undefined ? toBoolean(isCorrectGrade) : false,
        isIncorrectGrade: isIncorrectGrade !== undefined ? toBoolean(isIncorrectGrade) : false,
        mongoDbId: mongoDbId || null,
        gradingDetails: gradingDetails as any || null
      }
    });

    console.log(`Stored grading result for job ${jobId} -> Worksheet ${worksheet.id}`);

    // Update job in KV with Postgres ID
    const job = await kvService.getJSON<GradingJob>(`job:${jobId}`);
    if (job) {
      job.postgresId = worksheet.id;
      job.updatedAt = new Date().toISOString();
      await kvService.putJSON(`job:${jobId}`, job);
    }

    res.json({
      success: true,
      worksheetId: worksheet.id
    });

  } catch (error) {
    console.error('Error storing grading result:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error storing grading result'
    });
  }
};
