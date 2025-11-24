/**
 * Local Development Auto-Processor
 * 
 * Since Cloudflare Workers cron doesn't work in local dev,
 * this script polls the /process-jobs endpoint every 10 seconds
 * to simulate automatic job processing.
 * 
 * Usage:
 * 1. Start Worker: npx wrangler dev
 * 2. Start Backend: npm run dev (in backend folder)
 * 3. Run this script: node local-auto-processor.js
 */

const WORKER_URL = 'http://127.0.0.1:8787';
const POLL_INTERVAL = 10000; // 10 seconds

let processCount = 0;
let lastJobCount = 0;

async function processJobs() {
  try {
    console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Checking for jobs...`);
    
    // Check queue first
    const queueResponse = await fetch(`${WORKER_URL}/debug/queue`);
    const queueData = await queueResponse.json();
    
    const pendingCount = queueData.jobs.filter(j => 
      j.status === 'pending' || 
      (j.status === 'failed' && (j.retryCount || 0) < 3) ||
      (j.status === 'completed' && j.needsManualReview)
    ).length;
    
    if (pendingCount === 0) {
      console.log('   ✓ Queue empty');
      lastJobCount = 0;
      return;
    }
    
    console.log(`   📦 Found ${pendingCount} jobs to process`);
    
    // Trigger processing
    const startTime = Date.now();
    const response = await fetch(`${WORKER_URL}/process-jobs`);
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    if (result.success) {
      processCount++;
      console.log(`   ✅ Batch #${processCount} completed in ${duration}ms`);
      lastJobCount = pendingCount;
    } else {
      console.error(`   ❌ Processing failed:`, result.error);
    }
    
  } catch (error) {
    console.error(`   ❌ Error:`, error.message);
  }
}

// Start polling
console.log('🚀 Local Auto-Processor Started');
console.log(`   Worker URL: ${WORKER_URL}`);
console.log(`   Poll Interval: ${POLL_INTERVAL}ms (${POLL_INTERVAL/1000}s)`);
console.log(`   Press Ctrl+C to stop\n`);
console.log('=' .repeat(60));

// Initial check
processJobs();

// Poll every N seconds
setInterval(processJobs, POLL_INTERVAL);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping auto-processor...');
  console.log(`   Total batches processed: ${processCount}`);
  process.exit(0);
});
