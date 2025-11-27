import { Env, GradingJob, QueueJobMessage } from './types';
import { processJob } from './jobProcessor';
import { cleanupStaleJobs } from './cleanup';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'saarthi-grading-queue' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Add job to queue (called by backend)
    if (url.pathname === '/queue/add' && request.method === 'POST') {
      try {
        const message: QueueJobMessage = await request.json();
        await env.GRADING_QUEUE.send(message);
        console.log(`📤 Job ${message.jobId} added to queue`);
        return new Response(JSON.stringify({ success: true, jobId: message.jobId }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error adding job to queue:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // Add batch of jobs to queue
    if (url.pathname === '/queue/add-batch' && request.method === 'POST') {
      try {
        const messages: QueueJobMessage[] = await request.json();
        await env.GRADING_QUEUE.sendBatch(messages.map(msg => ({ body: msg })));
        console.log(`📤 Batch of ${messages.length} jobs added to queue`);
        return new Response(JSON.stringify({ 
          success: true, 
          count: messages.length,
          jobIds: messages.map(m => m.jobId)
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error adding batch to queue:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // Manual cleanup trigger
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
    
    // Debug: List all jobs in KV
    if (url.pathname === '/debug/jobs') {
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
                buffer: file.buffer ? `[${file.buffer.length} chars]` : null
              }));
            }
            jobs.push(job);
          }
        }
        
        return new Response(JSON.stringify({ success: true, total: jobs.length, jobs }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error in /debug/jobs:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // KV proxy endpoints (for backend)
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
    
    return new Response('Saarthi Grading Queue Worker', { status: 200 });
  },
  
  // Queue consumer - automatically called when messages arrive
  async queue(batch: MessageBatch<QueueJobMessage>, env: Env): Promise<void> {
    console.log(`\n📦 Queue batch: ${batch.messages.length} messages from ${batch.queue}`);
    
    // Handle dead letter queue
    if (batch.queue === 'grading-jobs-dlq') {
      await handleDeadLetterQueue(batch, env);
      return;
    }
    
    // Process all messages in parallel
    const results = await Promise.allSettled(
      batch.messages.map(message => processQueueMessage(message, env))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log(`✅ Batch complete: ${successful} succeeded, ${failed} failed`);
  },
  
  // Scheduled cleanup
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    console.log('🧹 Running scheduled cleanup');
    await cleanupStaleJobs(env);
  },
};

async function processQueueMessage(message: Message<QueueJobMessage>, env: Env): Promise<void> {
  const msg = message.body;
  const jobId = msg.jobId;
  
  console.log(`🔄 Processing job ${jobId} (attempt ${message.attempts})`);
  
  try {
    // Fetch files from KV
    const filesData = await env.SAARTHI_JOBS.get(`files:${jobId}`);
    if (!filesData) {
      throw new Error(`Files not found for job ${jobId}`);
    }
    
    const files = JSON.parse(filesData);
    console.log(`   📁 Loaded ${files.length} files`);
    
    // Reconstruct job object
    const job: GradingJob = {
      jobId: msg.jobId,
      batchId: msg.batchId,
      status: 'processing',
      createdAt: msg.createdAt,
      updatedAt: new Date().toISOString(),
      payload: { ...msg.payload, files },
      retryCount: message.attempts - 1,
    };
    
    // Update KV status
    await env.SAARTHI_JOBS.put(`job:${jobId}`, JSON.stringify(job));
    
    // Process (Python API + Postgres)
    await processJob(job, env);
    
    // Cleanup files
    await env.SAARTHI_JOBS.delete(`files:${jobId}`);
    
    // Acknowledge
    message.ack();
    console.log(`   ✅ Job ${jobId} completed`);
    
  } catch (error) {
    console.error(`   ❌ Job ${jobId} failed:`, error);
    
    // Update KV with error
    try {
      const jobData = await env.SAARTHI_JOBS.get(`job:${jobId}`);
      if (jobData) {
        const job: GradingJob = JSON.parse(jobData);
        job.status = message.attempts >= 3 ? 'failed' : 'pending';
        job.error = error instanceof Error ? error.message : String(error);
        job.retryCount = message.attempts;
        job.updatedAt = new Date().toISOString();
        await env.SAARTHI_JOBS.put(`job:${jobId}`, JSON.stringify(job));
      }
    } catch (kvError) {
      console.error(`   ⚠️ Failed to update KV:`, kvError);
    }
    
    // Retry with backoff
    if (message.attempts < 3) {
      const delaySeconds = 30 * Math.pow(2, message.attempts - 1);
      console.log(`   🔁 Retry in ${delaySeconds}s (attempt ${message.attempts + 1}/3)`);
      message.retry({ delaySeconds });
    }
  }
}

async function handleDeadLetterQueue(batch: MessageBatch<QueueJobMessage>, env: Env): Promise<void> {
  console.log(`☠️ Processing ${batch.messages.length} dead-letter jobs`);
  
  for (const message of batch.messages) {
    const jobId = message.body.jobId;
    
    try {
      const jobData = await env.SAARTHI_JOBS.get(`job:${jobId}`);
      if (jobData) {
        const job: GradingJob = JSON.parse(jobData);
        job.status = 'failed';
        job.error = job.error 
          ? `${job.error} | PERMANENTLY FAILED after 3 retries`
          : 'PERMANENTLY FAILED after 3 retries';
        job.updatedAt = new Date().toISOString();
        await env.SAARTHI_JOBS.put(`job:${jobId}`, JSON.stringify(job));
      }
      
      await env.SAARTHI_JOBS.delete(`files:${jobId}`);
    } catch (error) {
      console.error(`   ⚠️ DLQ error for ${jobId}:`, error);
    }
    
    message.ack();
  }
}
