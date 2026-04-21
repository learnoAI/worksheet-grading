import express from 'express';
import { asHandler } from '../middleware/utils';
import { requireGradingWorkerToken } from '../middleware/gradingWorkerAuth';
import { acquireJob, complete, fail, heartbeat, requeue, resetDispatch } from '../controllers/internalGradingWorkerController';

const router = express.Router();

router.use(requireGradingWorkerToken);

router.post('/jobs/:jobId/acquire', asHandler(acquireJob));
router.post('/jobs/:jobId/heartbeat', asHandler(heartbeat));
router.post('/jobs/:jobId/complete', asHandler(complete));
router.post('/jobs/:jobId/fail', asHandler(fail));
router.post('/jobs/:jobId/requeue', asHandler(requeue));
router.post('/jobs/:jobId/reset-dispatch', asHandler(resetDispatch));

export default router;
