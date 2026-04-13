import { NextFunction, Request, Response } from 'express';

/**
 * Shared-secret auth for worksheet creation CF worker -> backend internal endpoints.
 *
 * Header: X-Worksheet-Creation-Token: <WORKSHEET_CREATION_WORKER_TOKEN>
 */
export function requireWorksheetCreationToken(req: Request, res: Response, next: NextFunction): void {
    const configured = process.env.WORKSHEET_CREATION_WORKER_TOKEN;

    if (!configured) {
        res.status(500).json({ success: false, error: 'WORKSHEET_CREATION_WORKER_TOKEN is not configured' });
        return;
    }

    const provided = req.header('X-Worksheet-Creation-Token');

    if (!provided || provided !== configured) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    next();
}
