import express from 'express';
import {
    getAllClasses,
    getArchivedClasses,
    archiveClass,
    unarchiveClass,
    getClassById
} from '../controllers/classController';
import { UserRole } from '@prisma/client';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

// Protect all class management routes for SuperAdmin only
router.use(auth);
router.use(authorizeRoles([UserRole.SUPERADMIN]));

// Get all classes (with option to include archived)
router.get('/', asHandler(getAllClasses));

// Get archived classes only
router.get('/archived', asHandler(getArchivedClasses));

// Get class details by ID
router.get('/:id', asHandler(getClassById));

// Archive a class
router.post('/:id/archive', asHandler(archiveClass));

// Unarchive a class
router.post('/:id/unarchive', asHandler(unarchiveClass));

export default router;
