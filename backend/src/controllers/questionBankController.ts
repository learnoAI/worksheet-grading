import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { onSkillQuestionsReady } from '../services/worksheetBatchService';

/**
 * POST /internal/question-bank/store
 * Called by CF worker to store generated questions.
 * Body: { mathSkillId, questions: [{question, answer, instruction, renderSpec?}], batchId? }
 */
export async function storeQuestions(req: Request, res: Response): Promise<Response> {
    const { mathSkillId, questions, batchId } = req.body;

    if (!mathSkillId || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ success: false, error: 'mathSkillId and questions[] required' });
    }

    const created = await prisma.questionBank.createMany({
        data: questions.map((q: any) => buildQuestionBankRow(mathSkillId, q))
    });

    // If part of a batch, notify batch service. The `idempotent` flag in
    // the response tells the caller whether THIS call advanced the
    // batch counter — false on first delivery, true on CF Queue
    // redelivery of the same (batchId, mathSkillId). Useful for the
    // redelivery-rate dashboard. Omitted entirely when no batchId was
    // provided (no counter to track).
    let idempotent: boolean | undefined;
    if (batchId) {
        try {
            const result = await onSkillQuestionsReady(batchId, mathSkillId);
            idempotent = result.idempotent;
        } catch (err) {
            console.error(`[question-bank] onSkillQuestionsReady error for batch ${batchId}:`, err);
        }
    }

    const responseBody: { success: true; stored: number; idempotent?: boolean } = {
        success: true,
        stored: created.count
    };
    if (idempotent !== undefined) responseBody.idempotent = idempotent;
    return res.json(responseBody);
}

/**
 * POST /internal/question-bank/generate
 * Triggers question generation for a skill via CF worker.
 * Body: { mathSkillId, count? }
 */
export async function triggerGeneration(req: Request, res: Response): Promise<Response> {
    const { mathSkillId, count } = req.body;

    const skill = await prisma.mathSkill.findUnique({
        where: { id: mathSkillId },
        include: { mainTopic: true }
    });

    if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
    }

    const workerUrl = process.env.QUESTION_GENERATOR_WORKER_URL;
    if (!workerUrl) {
        return res.status(500).json({ success: false, error: 'QUESTION_GENERATOR_WORKER_URL not configured' });
    }

    try {
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Worksheet-Creation-Token': process.env.WORKSHEET_CREATION_WORKER_TOKEN ?? ''
            },
            body: JSON.stringify({
                mathSkillId: skill.id,
                skillName: skill.name,
                topicName: skill.mainTopic?.name ?? 'Math',
                count: count ?? 30
            })
        });

        if (!response.ok) {
            const text = await response.text();
            return res.status(502).json({ success: false, error: `Worker error: ${response.status} ${text}` });
        }

        const result = await response.json() as any;
        if (result.success && Array.isArray(result.questions)) {
            const created = await prisma.questionBank.createMany({
                data: result.questions.map((q: any) => buildQuestionBankRow(mathSkillId, q))
            });
            return res.json({ success: true, stored: created.count });
        }
        return res.status(502).json({ success: false, error: result.error ?? 'No questions returned' });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ success: false, error: message });
    }
}

function buildQuestionBankRow(mathSkillId: string, q: any) {
    return {
        mathSkillId,
        question: q.question,
        answer: q.answer,
        instruction: q.instruction,
        ...(q.renderSpec ? { renderSpec: q.renderSpec as Prisma.InputJsonValue } : {})
    };
}
