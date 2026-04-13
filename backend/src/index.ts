import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import worksheetRoutes from './routes/worksheetRoutes';
import notificationRoutes from './routes/notificationRoutes';
import worksheetTemplateRoutes from './routes/worksheetTemplateRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import worksheetProcessingRoutes from './routes/worksheetProcessingRoutes';
import classRoutes from './routes/classRoutes';
import schoolRoutes from './routes/schoolRoutes';
import gradingJobRoutes from './routes/gradingJobRoutes';
import internalGradingWorkerRoutes from './routes/internalGradingWorkerRoutes';
import internalQuestionBankRoutes from './routes/internalQuestionBankRoutes';
import internalWorksheetGenerationRoutes from './routes/internalWorksheetGenerationRoutes';
import masteryRoutes from './routes/masteryRoutes';
import worksheetGenerationRoutes from './routes/worksheetGenerationRoutes';
import config from './config/env';
import { requestDiagnostics } from './middleware/requestDiagnostics';
import { apiLogger } from './services/logger';
import { capturePosthogEvent, capturePosthogException } from './services/posthogService';
import { startGradingDispatchLoop } from './workers/gradingDispatchLoop';

// Legacy Bull queue remains available and enabled by default for backward compatibility.
if (process.env.ENABLE_LEGACY_BULL_QUEUE !== 'false') {
    void import('./services/queueService');
}

const app = express();

// Middleware
app.use(cors({
    origin: config.corsOrigins === '*' ? true : config.corsOrigins,
    credentials: true,
    methods: ['*'],
    allowedHeaders: ['*']
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(requestDiagnostics);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/worksheets', worksheetRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', worksheetTemplateRoutes); // Add worksheet template routes
app.use('/api/analytics', analyticsRoutes); // Add analytics routes
app.use('/api/worksheet-processing', worksheetProcessingRoutes); // Add worksheet processing routes
app.use('/api/classes', classRoutes); // Add class management routes
app.use('/api/schools', schoolRoutes); // Add school management routes
app.use('/api/grading-jobs', gradingJobRoutes); // Add grading job routes
app.use('/internal/grading-worker', internalGradingWorkerRoutes);
app.use('/internal/question-bank', internalQuestionBankRoutes);
app.use('/internal/worksheet-generation', internalWorksheetGenerationRoutes);
app.use('/api/mastery', masteryRoutes);
app.use('/api/worksheet-generation', worksheetGenerationRoutes);

// Health check route
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Default route
app.get('/', (req: Request, res: Response) => {
    res.send('AssessWise API');
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: any) => {
    console.error(err.stack);

    const requestId = req.get('x-request-id') || 'unknown';

    // Express's built-in body parser throws SyntaxError with a `body` property
    // when the request body can't be parsed — captured separately so it can be
    // alerted on independently of generic 5xx exceptions.
    if (err instanceof SyntaxError && 'body' in (err as any)) {
        void capturePosthogEvent('backend_request_body_parse_error', requestId, {
            path: req.originalUrl || req.url,
            method: req.method,
            errorMessage: err.message
        });
    } else {
        capturePosthogException(err, {
            distinctId: requestId,
            stage: 'express_error_middleware',
            extra: {
                path: req.originalUrl || req.url,
                method: req.method
            }
        });
    }

    res.status(500).json({
        message: 'An unexpected error occurred',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Process-level crash telemetry — routes unhandled rejections and uncaught
// exceptions through PostHog Error Tracking so silent crashes become visible.
// Both handlers are best-effort and never block Node's default crash handling.
process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    apiLogger.error('unhandled_rejection', { reason: message }, reason instanceof Error ? reason : undefined);
    try {
        capturePosthogException(reason, { distinctId: 'process', stage: 'unhandled_rejection' });
    } catch {
        // never block crash handling
    }
});

process.on('uncaughtException', (err) => {
    apiLogger.error('uncaught_exception', { error: err.message }, err);
    try {
        capturePosthogException(err, { distinctId: 'process', stage: 'uncaught_exception' });
    } catch {
        // never block crash handling
    }
    // Node is in an undefined state after an uncaught exception — the event
    // loop may be corrupted and continuing execution is more dangerous than
    // restarting. Exit so the process manager (PM2 / Docker / DO App Platform)
    // can spin up a clean instance.
    process.exit(1);
});

const APP_PORT = config.port;

app.listen(APP_PORT, () => {
    console.log(`Server started on port ${APP_PORT}`);

    if (config.grading.queueMode === 'cloudflare' && config.grading.dispatchLoopOnWeb) {
        startGradingDispatchLoop();
        console.log('Grading dispatch loop started in web process');
    }
});
