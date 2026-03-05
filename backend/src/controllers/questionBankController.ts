import { Request, Response } from 'express';
import prisma from '../utils/prisma';

/**
 * POST /internal/question-bank/store
 * Called by CF worker to store generated questions.
 * Body: { mathSkillId, questions: [{question, answer, instruction}] }
 */
export async function storeQuestions(req: Request, res: Response): Promise<Response> {
    const { mathSkillId, questions } = req.body;

    if (!mathSkillId || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ success: false, error: 'mathSkillId and questions[] required' });
    }

    const created = await prisma.questionBank.createMany({
        data: questions.map((q: any) => ({
            mathSkillId,
            question: q.question,
            answer: q.answer,
            instruction: q.instruction
        }))
    });

    return res.json({ success: true, stored: created.count });
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
                data: result.questions.map((q: any) => ({
                    mathSkillId,
                    question: q.question,
                    answer: q.answer,
                    instruction: q.instruction
                }))
            });
            return res.json({ success: true, stored: created.count });
        }
        return res.status(502).json({ success: false, error: result.error ?? 'No questions returned' });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ success: false, error: message });
    }
}
