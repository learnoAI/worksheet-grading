import dotenv from 'dotenv';

dotenv.config();

function parseNumber(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStorageProvider(value: string | undefined): 's3' | 'r2' {
    return value?.toLowerCase() === 'r2' ? 'r2' : 's3';
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
        return true;
    }
    if (normalized === 'false') {
        return false;
    }
    return fallback;
}

const gradingQueueMode = process.env.GRADING_QUEUE_MODE === 'cloudflare' ? 'cloudflare' : 'inline';
const storageProvider = parseStorageProvider(process.env.OBJECT_STORAGE_PROVIDER);

export default {
    // DigitalOcean App Platform (and most PaaS) injects `PORT` for web services.
    // Keep `APP_PORT` for local/dev overrides.
    port: parseNumber(process.env.PORT || process.env.APP_PORT, 5100),
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
        // Support both names: CF_* is used by this app, CLOUDFLARE_* is commonly used elsewhere.
        apiToken: process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '',
        consumerName: process.env.CF_CONSUMER_NAME || 'grading-worker',
        apiBaseUrl: process.env.CF_API_BASE_URL || process.env.CLOUDFLARE_API_BASE_URL || 'https://api.cloudflare.com/client/v4'
    },
    worksheetGeneration: {
        questionQueueId: process.env.QUESTION_GENERATION_QUEUE_ID || '',
        pdfQueueId: process.env.PDF_RENDERING_QUEUE_ID || '',
    },
    posthog: {
        apiKey: process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY || '',
        host: process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        exceptionsEnabled: parseBoolean(process.env.POSTHOG_EXCEPTIONS_ENABLED, Boolean(process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY))
    },
    diagnostics: {
        enabled: parseBoolean(process.env.REQUEST_DIAGNOSTICS_ENABLED, true),
        slowRequestMs: parseNumber(process.env.REQUEST_DIAGNOSTICS_SLOW_MS, 1500),
        gradingPersistenceSlowMs: parseNumber(process.env.GRADING_PERSISTENCE_SLOW_MS, 750)
    },
    gradingWorkerToken: process.env.GRADING_WORKER_TOKEN || '',
    grading: {
        queueMode: gradingQueueMode,
        pullWorkerEnabled: process.env.GRADING_PULL_WORKER_ENABLED === 'true',
        fastMaxPages: parseNumber(process.env.GRADING_FAST_MAX_PAGES, 4),
        maxConcurrent: parseNumber(process.env.GRADING_MAX_CONCURRENT, 5),
        minTimeMs: parseNumber(process.env.GRADING_MIN_TIME_MS, 200),
        workerConcurrency: parseNumber(process.env.GRADING_WORKER_CONCURRENCY, 5),
        queuePollBatchSize: parseNumber(process.env.GRADING_QUEUE_POLL_BATCH_SIZE, 25),
        queuePollIntervalMs: parseNumber(process.env.GRADING_QUEUE_POLL_INTERVAL_MS, 2000),
        heartbeatIntervalMs: parseNumber(process.env.GRADING_HEARTBEAT_INTERVAL_MS, 10000),
        staleProcessingMs: parseNumber(process.env.GRADING_STALE_PROCESSING_MS, 1200000),
        dispatchLoopIntervalMs: parseNumber(process.env.GRADING_DISPATCH_LOOP_INTERVAL_MS, 5000),
        dispatchLoopOnWeb: parseBoolean(process.env.GRADING_DISPATCH_LOOP_ON_WEB, true)
    }
};
