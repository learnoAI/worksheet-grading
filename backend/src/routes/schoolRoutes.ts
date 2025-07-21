import express from 'express';
import { body } from 'express-validator';
import {
    getAllSchools,
    getArchivedSchools,
    getSchoolById,
    createSchool,
    updateSchool,
    archiveSchool,
    unarchiveSchool,
    deleteSchool
} from '../controllers/schoolController';
import { UserRole } from '@prisma/client';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

// Protect all school management routes for SuperAdmin only
router.use(auth);
router.use(authorizeRoles([UserRole.SUPERADMIN]));

// Get all schools (with option to include archived)
router.get('/', asHandler(getAllSchools));

// Get archived schools only
router.get('/archived', asHandler(getArchivedSchools));

// Get school by ID
router.get('/:id', asHandler(getSchoolById));

// Create a new school
router.post(
    '/',
    [
        body('name').notEmpty().withMessage('School name is required').trim()
    ],
    asHandler(createSchool)
);

// Update a school
router.put(
    '/:id',
    [
        body('name').optional().notEmpty().withMessage('School name cannot be empty').trim()
    ],
    asHandler(updateSchool)
);

// Archive a school
router.post('/:id/archive', asHandler(archiveSchool));

// Unarchive a school
router.post('/:id/unarchive', asHandler(unarchiveSchool));

// Delete a school (only if no associated data)
router.delete('/:id', asHandler(deleteSchool));

export default router;
