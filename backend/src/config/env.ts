import dotenv from 'dotenv';

dotenv.config();

function parseNumber(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStorageProvider(value: string | undefined): 's3' | 'r2' {
    return value?.toLowerCase() === 'r2' ? 'r2' : 's3';
}

const gradingQueueMode = process.env.GRADING_QUEUE_MODE === 'cloudflare' ? 'cloudflare' : 'inline';
const storageProvider = parseStorageProvider(process.env.OBJECT_STORAGE_PROVIDER);

export default {
    port: process.env.APP_PORT || 5100,
    nodeEnv: process.env.NODE_ENV || 'development',
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    corsOrigins: process.env.CORS_ORIGINS ?
        (process.env.CORS_ORIGINS === '*' ? '*' : process.env.CORS_ORIGINS.split(',')) : [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://us.i.posthog.com',
        'https://app.posthog.com',
        'https://eu.i.posthog.com',
        'https://us.posthog.com'
    ],
    aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
        s3BucketName: process.env.AWS_S3_BUCKET_NAME || 'worksheet-images'
    },
    objectStorage: {
        provider: storageProvider
    },
    r2: {
        accountId: process.env.R2_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '',
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        bucketName: process.env.R2_BUCKET_NAME || '',
        endpoint: process.env.R2_ENDPOINT || '',
        publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || ''
    },
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    pythonApiUrl: process.env.PYTHON_API_URL || 'https://saarthi-api-jzugp.ondigitalocean.app/',
    cloudflare: {
        accountId: process.env.CF_ACCOUNT_ID || '',
        queueId: process.env.CF_QUEUE_ID || '',
        apiToken: process.env.CF_API_TOKEN || '',
        consumerName: process.env.CF_CONSUMER_NAME || 'grading-worker',
        apiBaseUrl: process.env.CF_API_BASE_URL || 'https://api.cloudflare.com/client/v4'
    },
    grading: {
        queueMode: gradingQueueMode,
        maxConcurrent: parseNumber(process.env.GRADING_MAX_CONCURRENT, 5),
        minTimeMs: parseNumber(process.env.GRADING_MIN_TIME_MS, 200),
        workerConcurrency: parseNumber(process.env.GRADING_WORKER_CONCURRENCY, 5),
        queuePollBatchSize: parseNumber(process.env.GRADING_QUEUE_POLL_BATCH_SIZE, 25),
        queuePollIntervalMs: parseNumber(process.env.GRADING_QUEUE_POLL_INTERVAL_MS, 2000),
        heartbeatIntervalMs: parseNumber(process.env.GRADING_HEARTBEAT_INTERVAL_MS, 10000),
        staleProcessingMs: parseNumber(process.env.GRADING_STALE_PROCESSING_MS, 180000),
        dispatchLoopIntervalMs: parseNumber(process.env.GRADING_DISPATCH_LOOP_INTERVAL_MS, 5000)
    }
};
