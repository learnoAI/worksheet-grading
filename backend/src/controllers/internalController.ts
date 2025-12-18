import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { ProcessingStatus, Prisma } from '@prisma/client';
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

    // Helper function to convert string booleans to actual booleans
    const toBoolean = (value: any): boolean => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.toLowerCase() === 'true';
      return Boolean(value);
    };

    const submittedOnDate = new Date(submittedOn);
    const dayStart = new Date(submittedOnDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(submittedOnDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Use a transaction with serializable isolation to prevent race conditions
    // This ensures only one concurrent request can create a worksheet for the same combination
    const result = await prisma.$transaction(async (tx) => {
      // Find or create worksheet template
      let template = await tx.worksheetTemplate.findFirst({
        where: { worksheetNumber: worksheetNum }
      });

      if (!template) {
        // Create template if it doesn't exist
        template = await tx.worksheetTemplate.create({
          data: {
            worksheetNumber: worksheetNum
          }
        });
      }

      // Check for existing worksheet within the transaction
      const existingWorksheet = await tx.worksheet.findFirst({
        where: {
          studentId,
          classId,
          templateId: template.id,
          submittedOn: {
            gte: dayStart,
            lte: dayEnd
          }
        }
      });

      if (existingWorksheet) {
        console.log(`⚠️ Idempotency: Worksheet already exists for job ${jobId} -> Worksheet ${existingWorksheet.id} (skipping duplicate creation)`);
        return { existing: true, worksheetId: existingWorksheet.id };
      }

      // Create new worksheet
      const worksheet = await tx.worksheet.create({
        data: {
          classId,
          studentId,
          submittedById: submittedById || 'system',
          templateId: template.id,
          grade: typeof grade === 'string' ? parseFloat(grade) : grade,
          outOf: gradingDetails?.total_possible || 40,
          notes: 'Auto-graded via background job',
          status: ProcessingStatus.COMPLETED,
          submittedOn: submittedOnDate,
          isAbsent: false,
          isRepeated: isRepeated !== undefined ? toBoolean(isRepeated) : false,
          isCorrectGrade: isCorrectGrade !== undefined ? toBoolean(isCorrectGrade) : false,
          isIncorrectGrade: isIncorrectGrade !== undefined ? toBoolean(isIncorrectGrade) : false,
          mongoDbId: mongoDbId || null,
          gradingDetails: gradingDetails as any || null
        }
      });

      console.log(`✅ Stored grading result for job ${jobId} -> Worksheet ${worksheet.id}`);
      return { existing: false, worksheetId: worksheet.id };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });

    // Update job in KV with Postgres ID
    const job = await kvService.getJSON<GradingJob>(`job:${jobId}`);
    if (job) {
      job.postgresId = result.worksheetId;
      job.updatedAt = new Date().toISOString();
      await kvService.putJSON(`job:${jobId}`, job);
    }

    if (result.existing) {
      return res.json({
        success: true,
        worksheetId: result.worksheetId,
        duplicate: true
      });
    }

    res.json({
      success: true,
      worksheetId: result.worksheetId
    });

  } catch (error) {
    // Handle serialization failure (race condition) - another transaction won
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      console.log(`⚠️ Transaction conflict for job - retrying or duplicate was created by another worker`);
      return res.status(409).json({
        success: false,
        error: 'Concurrent modification - please retry',
        retryable: true
      });
    }

    console.error('Error storing grading result:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error storing grading result'
    });
  }
};
