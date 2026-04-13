import express from 'express';
import { getWorksheetData, completeWorksheet, failWorksheet } from '../controllers/internalWorksheetGenerationController';
import { requireWorksheetCreationToken } from '../middleware/worksheetCreationAuth';
import { asHandler } from '../middleware/utils';

const router = express.Router();

router.use(requireWorksheetCreationToken);

router.get('/:id/data', asHandler(getWorksheetData));
router.post('/:id/complete', asHandler(completeWorksheet));
router.post('/:id/fail', asHandler(failWorksheet));

export default router;
