import { Env, GradingJob, PythonApiResponse } from './types';

export async function processJob(job: GradingJob, env: Env): Promise<void> {
  
  try {
    job.status = 'processing';
    job.updatedAt = new Date().toISOString();
    await env.SAARTHI_JOBS.put(`job:${job.jobId}`, JSON.stringify(job));
    
    console.log(`   🔄 Processing job ${job.jobId} for student ${job.payload.studentName}`);
    
    const formData = new FormData();
    
    if (job.payload.files) {
      for (const fileData of job.payload.files) {
        const binaryString = atob(fileData.buffer);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        formData.append('files', new Blob([bytes], { type: fileData.mimetype }), fileData.filename);
      }
      console.log(`   📁 Prepared ${job.payload.files.length} files for upload`);
    }
    
    console.log(`   🐍 Calling Python API...`);
    const pythonResponse = await fetch(
      `${env.PYTHON_API_URL}/process-worksheets?token_no=${encodeURIComponent(job.payload.tokenNo)}&worksheet_name=${encodeURIComponent(job.payload.worksheetName)}`,
      {
        method: 'POST',
        body: formData,
      }
    );
    
    if (!pythonResponse.ok) {
      throw new Error(`Python API returned ${pythonResponse.status}: ${await pythonResponse.text()}`);
    }
    
    const result: PythonApiResponse = await pythonResponse.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Python API returned success: false');
    }
    
    job.status = 'completed';
    job.result = {
      grade: result.grade || 0,
      mongoDbId: result.mongodb_id || '',
      total_possible: result.total_possible || 40,
      grade_percentage: result.grade_percentage || 0,
      total_questions: result.total_questions || 0,
      correct_answers: result.correct_answers || 0,
      wrong_answers: result.wrong_answers || 0,
      unanswered: result.unanswered || 0,
      question_scores: result.question_scores || [],
      wrong_questions: result.wrong_questions || [],
      correct_questions: result.correct_questions || [],
      unanswered_questions: result.unanswered_questions || [],
      overall_feedback: result.overall_feedback || '',
    };
    job.updatedAt = new Date().toISOString();
    await env.SAARTHI_JOBS.put(`job:${job.jobId}`, JSON.stringify(job));
    
    console.log(`   ✅ Job ${job.jobId} graded: ${job.result.grade}/${job.result.total_possible}`);
    
    await saveToPostgres(job, env);
    
  } catch (error) {
    console.error(`   ❌ Error in processJob for ${job.jobId}:`, error);
    
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.updatedAt = new Date().toISOString();
    await env.SAARTHI_JOBS.put(`job:${job.jobId}`, JSON.stringify(job));
    
    throw error;
  }
}

async function saveToPostgres(job: GradingJob, env: Env): Promise<void> {
  console.log(`Saving job ${job.jobId} to Postgres...`);
  
  const response = await fetch(`${env.NODE_BACKEND_URL}/internal/store-grading-result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': env.INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      jobId: job.jobId,
      classId: job.payload.classId,
      studentId: job.payload.studentId,
      submittedById: job.payload.submittedById,
      worksheetNumber: job.payload.worksheetNumber,
      grade: job.result?.grade || 0,
      submittedOn: job.payload.submittedOn,
      isRepeated: job.payload.isRepeated,
      isCorrectGrade: job.payload.isCorrectGrade || false,
      isIncorrectGrade: job.payload.isIncorrectGrade || false,
      mongoDbId: job.result?.mongoDbId || '',
      gradingDetails: job.result,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Postgres save failed: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json() as { worksheetId: string };
  
  console.log(`Job ${job.jobId} saved to Postgres with ID ${result.worksheetId}`);
  
  job.status = 'completed';
  job.postgresId = result.worksheetId;
  job.updatedAt = new Date().toISOString();
  
  await env.SAARTHI_JOBS.put(`job:${job.jobId}`, JSON.stringify(job), {
    expirationTtl: 10 * 60
  });
  
  await env.SAARTHI_JOBS.delete(`files:${job.jobId}`);
  console.log(`   🗑️  Files cleaned up, job ${job.jobId} will expire in 10 mins`);
}
