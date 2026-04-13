import express from 'express';
import { storeQuestions, triggerGeneration } from '../controllers/questionBankController';
import { requireWorksheetCreationToken } from '../middleware/worksheetCreationAuth';
import { asHandler } from '../middleware/utils';

const router = express.Router();

router.use(requireWorksheetCreationToken);

router.post('/store', asHandler(storeQuestions));
router.post('/generate', asHandler(triggerGeneration));

export default router;
