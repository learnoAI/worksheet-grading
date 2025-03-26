"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const worksheetRoutes_1 = __importDefault(require("./routes/worksheetRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const worksheetTemplateRoutes_1 = __importDefault(require("./routes/worksheetTemplateRoutes"));
const env_1 = __importDefault(require("./config/env"));
require("./services/queueService"); // Initialize queue
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/users', userRoutes_1.default);
app.use('/api/worksheets', worksheetRoutes_1.default);
app.use('/api/notifications', notificationRoutes_1.default);
app.use('/api', worksheetTemplateRoutes_1.default); // Add worksheet template routes
// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});
// Default route
app.get('/', (req, res) => {
    res.send('Worksheet Grading API');
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        message: 'An unexpected error occurred',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});
const APP_PORT = env_1.default.port;
app.listen(APP_PORT, () => {
    console.log(`Server started on port ${APP_PORT}`);
});
