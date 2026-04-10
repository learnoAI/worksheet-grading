import express from 'express';
import { body, query } from 'express-validator';
import { auth, authorizeRoles } from '../middleware/utils';
import { asHandler } from '../middleware/utils';
import { UserRole } from '@prisma/client';
import multer from 'multer';
import {
    createDirectUploadSession,
    finalizeDirectUploadSession,
    getDirectUploadSession,
    processWorksheets
} from '../controllers/worksheetProcessingController';

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
    upload.array('files', 10), // Allow up to 10 images with field name 'files'
    [
        body('token_no').notEmpty().withMessage('Token number is required'),
        body('worksheet_name').notEmpty().withMessage('Worksheet name is required')
    ],
    asHandler(processWorksheets)
);

export default router;
