import { NextFunction, Request, Response } from 'express';
import config from '../config/env';

/**
 * Shared-secret auth for Cloudflare grading worker -> backend internal endpoints.
 *
 * Header: X-Grading-Worker-Token: <GRADING_WORKER_TOKEN>
 */
export function requireGradingWorkerToken(req: Request, res: Response, next: NextFunction): void {
    const configured = config.gradingWorkerToken;

    if (!configured) {
        res.status(500).json({ success: false, error: 'GRADING_WORKER_TOKEN is not configured' });
        return;
    }

    const provided = req.header('X-Grading-Worker-Token');

    if (!provided || provided !== configured) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    next();
}

