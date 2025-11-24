import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import kvService from '../services/cloudflareKV';
import fetch from 'node-fetch';
import FormData from 'form-data';
import {
  GradingJob,
  BatchJob,
  CreateJobRequest,
  CreateBatchJobRequest,
  GradingJobStatus
} from '../types/gradingJob';

// Create single grading job (with file upload)
export const createGradingJob = async (req: Request, res: Response) => {
  try {
    if (!kvService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Background jobs service not configured. Using synchronous processing.'
      });
    }

    const {
      tokenNo,
      worksheetName,
      studentId,
      studentName,
      classId,
      submittedOn,
      worksheetNumber,
      isRepeated,
      isCorrectGrade,
      isIncorrectGrade
    } = req.body;
    
    // Get uploaded files
    const files = req.files as Express.Multer.File[] | undefined;

    // Validation
    if (!tokenNo || !worksheetName || !studentId || !studentName || !classId || !submittedOn || !worksheetNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const jobId = uuidv4();
    const now = new Date().toISOString();
    
    // Store files as base64 in job payload for Worker to process
    const fileData = files.map(file => ({
      filename: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer.toString('base64')
    }));

    const job: GradingJob = {
      jobId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      payload: {
        tokenNo,
        worksheetName,
        studentId,
        studentName,
        classId,
        submittedOn,
        worksheetNumber,
        isRepeated: isRepeated || false,
        isCorrectGrade: isCorrectGrade || false,
        isIncorrectGrade: isIncorrectGrade || false,
        submittedById: req.user?.userId || '',
        files: fileData
      },
      retryCount: 0
    };

    // Store job in KV
    await kvService.putJSON(`job:${jobId}`, job);

    // Add to class-date index for quick lookup
    const indexKey = `class-date:${classId}:${submittedOn}`;
    const existingIndex = await kvService.getJSON<string[]>(indexKey) || [];
    existingIndex.push(jobId);
    await kvService.putJSON(indexKey, existingIndex, {
      expirationTtl: 24 * 60 * 60 // 24 hours
    });

    console.log(`Created grading job ${jobId} for student ${studentName}`);

    res.json({
      success: true,
      jobId,
      status: 'pending'
    });

  } catch (error) {
    console.error('Error creating grading job:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error creating grading job'
    });
  }
};

// Create batch grading jobs
export const createBatchGradingJobs = async (req: Request, res: Response) => {
  try {
    if (!kvService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Background jobs service not configured'
      });
    }

    const { jobs, classId, submittedOn }: CreateBatchJobRequest = req.body;

    if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No jobs provided'
      });
    }

    const batchId = uuidv4();
    const now = new Date().toISOString();
    const jobIds: string[] = [];

    // Create all jobs
    for (const jobData of jobs) {
      const jobId = uuidv4();
      jobIds.push(jobId);

      const job: GradingJob = {
        jobId,
        batchId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        payload: {
          ...jobData,
          submittedById: req.user?.userId || ''
        },
        retryCount: 0
      };

      await kvService.putJSON(`job:${jobId}`, job);
    }

    // Create batch tracking entry
    const batch: BatchJob = {
      batchId,
      classId,
      submittedOn,
      totalJobs: jobs.length,
      completedJobs: 0,
      failedJobs: 0,
      pendingJobs: jobs.length,
      processingJobs: 0,
      jobIds,
      createdAt: now,
      updatedAt: now
    };

    await kvService.putJSON(`batch:${batchId}`, batch, {
      expirationTtl: 24 * 60 * 60
    });

    // Add to class-date index
    const indexKey = `class-date:${classId}:${submittedOn}`;
    const existingIndex = await kvService.getJSON<string[]>(indexKey) || [];
    existingIndex.push(...jobIds);
    await kvService.putJSON(indexKey, existingIndex, {
      expirationTtl: 24 * 60 * 60
    });

    console.log(`Created batch ${batchId} with ${jobs.length} jobs`);

    res.json({
      success: true,
      batchId,
      jobIds,
      totalJobs: jobs.length
    });

  } catch (error) {
    console.error('Error creating batch jobs:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error creating batch jobs'
    });
  }
};

// Get job status
export const getJobStatus = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const job = await kvService.getJSON<GradingJob>(`job:${jobId}`);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      job: {
        jobId: job.jobId,
        status: job.status,
        result: job.result,
        postgresId: job.postgresId,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      }
    });

  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error getting job status'
    });
  }
};

// Get batch status
export const getBatchStatus = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    const batch = await kvService.getJSON<BatchJob>(`batch:${batchId}`);

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: 'Batch not found'
      });
    }

    // Get status of all jobs in batch
    const jobs = await Promise.all(
      batch.jobIds.map(async (jobId) => {
        const job = await kvService.getJSON<GradingJob>(`job:${jobId}`);
        return job ? {
          jobId: job.jobId,
          studentName: job.payload.studentName,
          status: job.status,
          result: job.result,
          postgresId: job.postgresId,
          error: job.error
        } : null;
      })
    );

    // Calculate current counts
    const validJobs = jobs.filter(j => j !== null);
    const completed = validJobs.filter(j => j.status === 'completed').length;
    const failed = validJobs.filter(j => j.status === 'failed').length;
    const processing = validJobs.filter(j => j.status === 'processing').length;
    const pending = validJobs.filter(j => j.status === 'pending').length;

    res.json({
      success: true,
      batch: {
        batchId: batch.batchId,
        totalJobs: batch.totalJobs,
        completed,
        failed,
        processing,
        pending,
        jobs: validJobs
      }
    });

  } catch (error) {
    console.error('Error getting batch status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error getting batch status'
    });
  }
};

// Get jobs by class and date
export const getJobsByClass = async (req: Request, res: Response) => {
  try {
    const { classId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date parameter is required'
      });
    }

    const indexKey = `class-date:${classId}:${date}`;
    const jobIds = await kvService.getJSON<string[]>(indexKey) || [];

    if (jobIds.length === 0) {
      return res.json({
        success: true,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        jobs: []
      });
    }

    // Get all jobs
    const jobs = await Promise.all(
      jobIds.map(async (jobId) => {
        const job = await kvService.getJSON<GradingJob>(`job:${jobId}`);
        return job ? {
          jobId: job.jobId,
          studentName: job.payload.studentName,
          tokenNo: job.payload.tokenNo,
          status: job.status,
          result: job.result,
          postgresId: job.postgresId,
          error: job.error
        } : null;
      })
    );

    const validJobs = jobs.filter(j => j !== null);
    const pending = validJobs.filter(j => j.status === 'pending').length;
    const processing = validJobs.filter(j => j.status === 'processing').length;
    const completed = validJobs.filter(j => j.status === 'completed').length;
    const failed = validJobs.filter(j => j.status === 'failed').length;

    res.json({
      success: true,
      pending,
      processing,
      completed,
      failed,
      jobs: validJobs
    });

  } catch (error) {
    console.error('Error getting jobs by class:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error getting jobs'
    });
  }
};
