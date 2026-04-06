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
import config from './config/env';
import { requestDiagnostics } from './middleware/requestDiagnostics';
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
    res.status(500).json({
        message: 'An unexpected error occurred',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const APP_PORT = config.port;

app.listen(APP_PORT, () => {
    console.log(`Server started on port ${APP_PORT}`);

    if (config.grading.queueMode === 'cloudflare' && config.grading.dispatchLoopOnWeb) {
        startGradingDispatchLoop();
        console.log('Grading dispatch loop started in web process');
    }
});
