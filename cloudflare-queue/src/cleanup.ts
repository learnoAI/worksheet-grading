import { Env, GradingJob } from './types';

export async function cleanupStaleJobs(env: Env): Promise<void> {
  console.log('Starting cleanup of stale jobs...');
  
  const list = await env.SAARTHI_JOBS.list({ prefix: 'job:' });
  const now = Date.now();
  let deletedCount = 0;
  let markedFailedCount = 0;
  let alertCount = 0;
  
  for (const key of list.keys) {
    try {
      const jobData = await env.SAARTHI_JOBS.get(key.name);
      if (!jobData) continue;
      
      const job: GradingJob = JSON.parse(jobData);
      const updatedAt = new Date(job.updatedAt).getTime();
      const ageInHours = (now - updatedAt) / (1000 * 60 * 60);
      
      // Delete failed jobs after 24 hours
      if (job.status === 'failed' && ageInHours > 24) {
        await env.SAARTHI_JOBS.delete(key.name);
        deletedCount++;
        console.log(`🗑️ Deleted failed job ${job.jobId} (${ageInHours.toFixed(1)}h old)`);
      }
      
      // Mark stuck "processing" jobs as failed after 1 hour
      else if (job.status === 'processing' && ageInHours > 1) {
        job.status = 'failed';
        job.error = 'Job stuck in processing state - worker may have crashed';
        job.updatedAt = new Date().toISOString();
        await env.SAARTHI_JOBS.put(key.name, JSON.stringify(job));
        markedFailedCount++;
        console.log(`⚠️ Marked stuck job ${job.jobId} as failed (${ageInHours.toFixed(1)}h old)`);
      }
      
      // Alert on completed jobs without Postgres ID after 6 hours
      else if (job.status === 'completed' && !job.postgresId && ageInHours > 6) {
        alertCount++;
        console.error(`🚨 ALERT: Job ${job.jobId} completed but not saved to Postgres for ${ageInHours.toFixed(1)}h`);
        console.error(`  Student: ${job.payload.studentName}, Worksheet: ${job.payload.worksheetNumber}`);
        if (job.postgresError) {
          console.error(`  Error: ${job.postgresError}`);
        }
      }
      
    } catch (error) {
      console.error(`Error processing cleanup for ${key.name}:`, error);
    }
  }
  
  console.log(`Cleanup complete: ${deletedCount} deleted, ${markedFailedCount} marked failed, ${alertCount} alerts`);
}
