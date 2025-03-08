import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import worksheetRoutes from './routes/worksheetRoutes';
import notificationRoutes from './routes/notificationRoutes';
import config from './config/env';
import './services/queueService'; // Initialize queue

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/worksheets', worksheetRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check route
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Default route
app.get('/', (req: Request, res: Response) => {
    res.send('Worksheet Grading API');
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
});