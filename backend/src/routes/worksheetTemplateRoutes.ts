import express from 'express';
import { body } from 'express-validator';
import {
    getAllWorksheetTemplates,
    getWorksheetTemplateById,
    createWorksheetTemplate,
    updateWorksheetTemplate,
    deleteWorksheetTemplate,
    addTemplateImage,
    deleteTemplateImage,
    addTemplateQuestion,
    updateTemplateQuestion,
    deleteTemplateQuestion,
    getAllMathSkills,
    createMathSkill
} from '../controllers/worksheetTemplateController';
import { UserRole } from '@prisma/client';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

// Worksheet Template routes
router.get('/worksheet-templates', auth, asHandler(getAllWorksheetTemplates));
router.get('/worksheet-templates/:id', auth, asHandler(getWorksheetTemplateById));

// SUPERADMIN only routes
router.post(
    '/worksheet-templates',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('worksheetNumber').optional().isInt().withMessage('Worksheet number must be an integer')
    ],
    asHandler(createWorksheetTemplate)
);

router.put(
    '/worksheet-templates/:id',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('worksheetNumber').optional().isInt().withMessage('Worksheet number must be an integer')
    ],
    asHandler(updateWorksheetTemplate)
);

router.delete(
    '/worksheet-templates/:id',
    [auth, authorizeRoles([UserRole.SUPERADMIN])],
    asHandler(deleteWorksheetTemplate)
);

// Template image routes
router.post(
    '/worksheet-templates/:id/images',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('imageUrl').notEmpty().withMessage('Image URL is required'),
        body('pageNumber').isInt().withMessage('Page number must be an integer')
    ],
    asHandler(addTemplateImage)
);

router.delete(
    '/worksheet-templates/images/:id',
    [auth, authorizeRoles([UserRole.SUPERADMIN])],
    asHandler(deleteTemplateImage)
);

// Template question routes
router.post(
    '/worksheet-templates/:id/questions',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('question').notEmpty().withMessage('Question is required'),
        body('answer').optional(),
        body('outOf').optional().isNumeric().withMessage('Out of must be a number'),
        body('skillIds').optional().isArray().withMessage('Skill IDs must be an array')
    ],
    asHandler(addTemplateQuestion)
);

router.put(
    '/worksheet-templates/questions/:id',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('question').optional(),
        body('answer').optional(),
        body('outOf').optional().isNumeric().withMessage('Out of must be a number'),
        body('skillIds').optional().isArray().withMessage('Skill IDs must be an array')
    ],
    asHandler(updateTemplateQuestion)
);

router.delete(
    '/worksheet-templates/questions/:id',
    [auth, authorizeRoles([UserRole.SUPERADMIN])],
    asHandler(deleteTemplateQuestion)
);

// Math skill routes
router.get('/math-skills', auth, asHandler(getAllMathSkills));

router.post(
    '/math-skills',
    [
        auth,
        authorizeRoles([UserRole.SUPERADMIN]),
        body('name').notEmpty().withMessage('Name is required'),
        body('description').optional()
    ],
    asHandler(createMathSkill)
);

export default router; 