import express from 'express';
import { UserRole } from '@prisma/client';
import { generate, listForStudent, getPdf } from '../controllers/worksheetGenerationController';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

router.use(auth);
router.use(authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]));

router.post('/generate', asHandler(generate));
router.get('/student/:studentId', asHandler(listForStudent));
router.get('/:id/pdf', asHandler(getPdf));

export default router;
