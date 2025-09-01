import dotenv from 'dotenv';

dotenv.config();

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
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    pythonApiUrl: process.env.PYTHON_API_URL || 'https://saarthi-api-jzugp.ondigitalocean.app/',
    grading: {
        maxConcurrent: parseInt(process.env.GRADING_MAX_CONCURRENT || '1', 10),
        minTimeMs: parseInt(process.env.GRADING_MIN_TIME_MS || '1000', 10)
    }
};
