import { Env, GradingJob } from './types';
import { processJob } from './jobProcessor';
import { cleanupStaleJobs } from './cleanup';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'saarthi-grading-worker' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Process jobs endpoint (called by cron or manually)
    if (url.pathname === '/process-jobs') {
      try {
        const startTime = Date.now();
        await processJobs(env);
        const duration = Date.now() - startTime;
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Jobs processed',
          duration: `${duration}ms`,
          maxConcurrent: parseInt(env.MAX_CONCURRENT_JOBS || '10')
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /process-jobs:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // Process single job (for manual retry)
    if (url.pathname.startsWith('/process-job/')) {
      const jobId = url.pathname.split('/')[2];
      try {
        const jobData = await env.SAARTHI_JOBS.get(`job:${jobId}`);
        if (!jobData) {
          return new Response(JSON.stringify({ success: false, error: 'Job not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        const job: GradingJob = JSON.parse(jobData);
        await processJob(job, env);
        
        return new Response(JSON.stringify({ success: true, jobId }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`Error processing job ${jobId}:`, error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // Cleanup endpoint
    if (url.pathname === '/cleanup') {
      try {
        await cleanupStaleJobs(env);
        return new Response(JSON.stringify({ success: true, message: 'Cleanup completed' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /cleanup:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // Debug: List all jobs in queue
    if (url.pathname === '/debug/queue') {
      try {
        const list = await env.SAARTHI_JOBS.list({ prefix: 'job:' });
        const jobs = [];
        
        for (const key of list.keys) {
          const jobData = await env.SAARTHI_JOBS.get(key.name);
          if (jobData) {
            const job = JSON.parse(jobData);
            
            // Truncate file buffers for readability
            if (job.payload?.files) {
              job.payload.files = job.payload.files.map((file: any) => ({
                ...file,
                buffer: file.buffer ? file.buffer.substring(0, 50) + `... (${file.buffer.length} chars)` : null
              }));
            }
            
            jobs.push(job);
          }
        }
        
        return new Response(JSON.stringify({ 
          success: true, 
          total: jobs.length,
          jobs 
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /debug/queue:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // KV proxy endpoints (for backend to use when running locally)
    if (url.pathname === '/kv/put' && request.method === 'PUT') {
      try {
        const { key, value, expirationTtl } = await request.json() as any;
        const options: any = {};
        if (expirationTtl) options.expirationTtl = expirationTtl;
        
        await env.SAARTHI_JOBS.put(key, value, options);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /kv/put:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    if (url.pathname === '/kv/get' && request.method === 'POST') {
      try {
        const { key } = await request.json() as any;
        const value = await env.SAARTHI_JOBS.get(key);
        return new Response(JSON.stringify({ success: true, value }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /kv/get:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    if (url.pathname === '/kv/delete' && request.method === 'DELETE') {
      try {
        const { key } = await request.json() as any;
        await env.SAARTHI_JOBS.delete(key);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /kv/delete:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    if (url.pathname === '/kv/list' && request.method === 'POST') {
      try {
        const { prefix, limit, cursor } = await request.json() as any;
        const options: any = {};
        if (prefix) options.prefix = prefix;
        if (limit) options.limit = limit;
        if (cursor) options.cursor = cursor;
        
        const result = await env.SAARTHI_JOBS.list(options);
        return new Response(JSON.stringify({ success: true, result }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /kv/list:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    return new Response('Saarthi Grading Worker', { status: 200 });
  },
  
  // Cron trigger (every 1 minute)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('\n🕐 CRON TRIGGERED at', new Date().toISOString());
    console.log('=' .repeat(60));
    
    // Process pending/failed jobs automatically
    await processJobs(env);
    
    // Hourly cleanup
    const now = new Date();
    if (now.getMinutes() === 0) {
      console.log('\n🧹 Running hourly cleanup...');
      await cleanupStaleJobs(env);
    }
    
    console.log('=' .repeat(60));
  },
};

async function processJobs(env: Env): Promise<void> {
  const maxConcurrent = parseInt(env.MAX_CONCURRENT_JOBS || '10');
  const maxRetries = parseInt(env.MAX_RETRY_ATTEMPTS || '3');
  
  console.log(`🔍 Checking for jobs to process (max ${maxConcurrent} parallel)...`);
  
  // List all jobs
  const list = await env.SAARTHI_JOBS.list({ prefix: 'job:' });
  const jobsToProcess: GradingJob[] = [];
  
  // Find pending jobs AND failed/completed jobs that need manual review or retry
  for (const key of list.keys) {
    if (jobsToProcess.length >= maxConcurrent) break;
    
    const jobData = await env.SAARTHI_JOBS.get(key.name);
    if (!jobData) continue;
    
    const job: GradingJob = JSON.parse(jobData);
    
    // Process if:
    // 1. pending (new job)
    // 2. failed with retries remaining
    // 3. completed but needs manual review (Postgres save failed)
    const shouldProcess = 
      job.status === 'pending' ||
      (job.status === 'failed' && (job.retryCount || 0) < maxRetries) ||
      (job.status === 'completed' && job.needsManualReview && (job.retryCount || 0) < maxRetries);
    
    if (shouldProcess) {
      jobsToProcess.push(job);
    }
  }
  
  if (jobsToProcess.length === 0) {
    console.log('✓ No jobs to process');
    return;
  }
  
  console.log(`📦 Found ${jobsToProcess.length} jobs to process`);
  
  // Process jobs in parallel with error handling
  const startTime = Date.now();
  console.log(`⚡ Starting batch processing of ${jobsToProcess.length} jobs in parallel...`);
  
  const results = await Promise.allSettled(jobsToProcess.map(job => processJob(job, env)));
  const duration = Date.now() - startTime;
  
  // Log results
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`✅ Batch processing complete in ${duration}ms (${(duration/1000).toFixed(2)}s)`);
  console.log(`   ✓ ${successful} succeeded, ✗ ${failed} failed`);
}
