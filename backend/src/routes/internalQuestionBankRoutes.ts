import express from 'express';
import { storeQuestions, triggerGeneration } from '../controllers/questionBankController';
import { requireGradingWorkerToken } from '../middleware/gradingWorkerAuth';
import { asHandler } from '../middleware/utils';

const router = express.Router();

router.use(requireGradingWorkerToken);

router.post('/store', asHandler(storeQuestions));
router.post('/generate', asHandler(triggerGeneration));

export default router;
