import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import { body, query } from 'express-validator';
import { auth, authorizeRoles } from '../middleware/utils';
import { asHandler } from '../middleware/utils';
import { UserRole } from '@prisma/client';
import multer, { MulterError } from 'multer';
import {
    createDirectUploadSession,
    finalizeDirectUploadSession,
    getDirectUploadSession,
    processWorksheets
} from '../controllers/worksheetProcessingController';
import { capturePosthogEvent } from '../services/posthogService';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept only images
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Wraps a multer middleware so any rejection (size, count, mime, other) is
// captured in PostHog before the error continues to the global Express error
// handler. Behaviour is identical on success — next() runs exactly once.
function withUploadTelemetry(middleware: RequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        middleware(req, res, (err?: unknown) => {
            if (!err) {
                return next();
            }

            let reason: 'size' | 'count' | 'mime' | 'multer_other' | 'unknown';
            let multerCode: string | null = null;
            if (err instanceof MulterError) {
                multerCode = err.code;
                if (err.code === 'LIMIT_FILE_SIZE') {
                    reason = 'size';
                } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
                    reason = 'count';
                } else {
                    reason = 'multer_other';
                }
            } else if (err instanceof Error && err.message === 'Only image files are allowed') {
                reason = 'mime';
            } else {
                reason = 'unknown';
            }

            void capturePosthogEvent('image_upload_rejected', req.get('x-request-id') || 'unknown', {
                reason,
                multerCode,
                path: req.originalUrl || req.url,
                errorMessage: err instanceof Error ? err.message : String(err)
            });

            return next(err);
        });
    };
}

// Process worksheets through Python API
router.post(
    '/upload-session',
    auth,
    authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
    asHandler(createDirectUploadSession)
);

router.get(
    '/upload-session/:batchId',
    auth,
    authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
    asHandler(getDirectUploadSession)
);

router.post(
    '/upload-session/:batchId/finalize',
    auth,
    authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]),
    asHandler(finalizeDirectUploadSession)
);

router.post(
    '/process',
    auth,
    withUploadTelemetry(upload.array('files', 10)), // Allow up to 10 images with field name 'files'
    [
        body('token_no').notEmpty().withMessage('Token number is required'),
        body('worksheet_name').notEmpty().withMessage('Worksheet name is required')
    ],
    asHandler(processWorksheets)
);

export default router;
