import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { planWorksheets } from './worksheetSchedulerService';

interface GenerationResult {
    worksheetIds: string[];
    status: 'PENDING' | 'COMPLETED' | 'PARTIAL';
    errors: string[];
}

interface SectionData {
    skillId: string;
    skillName: string;
    instruction: string;
    questions: { question: string; answer: string }[];
}

/**
 * Main entry point: generate N days of worksheets for a student.
 */
export async function generateWorksheets(
    studentId: string,
    days: number,
    startDate: Date
): Promise<GenerationResult> {
    const errors: string[] = [];

    // 1. Plan skills for each day
    const { plans, errors: planErrors } = await planWorksheets(studentId, days, startDate);
    errors.push(...planErrors);

    if (plans.length === 0) {
        return { worksheetIds: [], status: 'COMPLETED', errors };
    }

    // 2. Collect all unique skills needed
    const skillIds = new Set<string>();
    for (const plan of plans) {
        skillIds.add(plan.newSkillId);
        skillIds.add(plan.reviewSkill1Id);
        skillIds.add(plan.reviewSkill2Id);
    }

    // 3. Ensure enough questions exist for each skill
    await ensureQuestionsForSkills(Array.from(skillIds), errors);

    // 4. Create GeneratedWorksheet rows and assign questions
    const worksheetIds: string[] = [];
    for (const plan of plans) {
        try {
            const sections = await buildSections(plan.newSkillId, plan.reviewSkill1Id, plan.reviewSkill2Id);
            const ws = await prisma.generatedWorksheet.create({
                data: {
                    studentId,
                    scheduledDate: plan.scheduledDate,
                    newSkillId: plan.newSkillId,
                    reviewSkill1Id: plan.reviewSkill1Id,
                    reviewSkill2Id: plan.reviewSkill2Id,
                    sectionsJson: sections as unknown as Prisma.InputJsonValue,
                    status: 'QUESTIONS_READY'
                }
            });
            worksheetIds.push(ws.id);
        } catch (err) {
            errors.push(`Failed to create worksheet for ${plan.scheduledDate.toISOString()}: ${err}`);
        }
    }

    return {
        worksheetIds,
        status: errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
        errors
    };
}

/**
 * Ensure at least 20 questions exist per skill (need 10 or 20 per worksheet).
 * Triggers CF worker generation if insufficient.
 */
async function ensureQuestionsForSkills(skillIds: string[], errors: string[]): Promise<void> {
    for (const skillId of skillIds) {
        const count = await prisma.questionBank.count({ where: { mathSkillId: skillId } });
        if (count >= 30) continue; // Enough questions

        // Trigger generation
        const skill = await prisma.mathSkill.findUnique({
            where: { id: skillId },
            include: { mainTopic: true }
        });
        if (!skill) continue;

        const workerUrl = process.env.QUESTION_GENERATOR_WORKER_URL;
        if (!workerUrl) {
            errors.push(`QUESTION_GENERATOR_WORKER_URL not set, cannot generate for ${skill.name}`);
            continue;
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
                    count: 30
                })
            });
            if (!response.ok) {
                errors.push(`Question generation failed for ${skill.name}: ${response.status}`);
                continue;
            }
            const result = await response.json() as any;
            if (result.success && Array.isArray(result.questions) && result.questions.length > 0) {
                await prisma.questionBank.createMany({
                    data: result.questions.map((q: any) => ({
                        mathSkillId: skillId,
                        question: q.question,
                        answer: q.answer,
                        instruction: q.instruction
                    }))
                });
            } else {
                errors.push(`No questions returned for ${skill.name}: ${result.error ?? 'empty response'}`);
            }
        } catch (err) {
            errors.push(`Question generation error for ${skill.name}: ${err}`);
        }
    }
}

/**
 * Draw questions from QuestionBank for each section.
 * Returns 4 sections: [sectionA, sectionB, sectionC, sectionD]
 */
async function buildSections(
    newSkillId: string,
    review1Id: string,
    review2Id: string
): Promise<SectionData[]> {
    const drawQuestions = async (skillId: string, count: number) => {
        const questions = await prisma.questionBank.findMany({
            where: { mathSkillId: skillId },
            orderBy: { usedCount: 'asc' },
            take: count,
            select: { id: true, question: true, answer: true, instruction: true }
        });

        if (questions.length > 0) {
            await prisma.questionBank.updateMany({
                where: { id: { in: questions.map(q => q.id) } },
                data: { usedCount: { increment: 1 } }
            });
        }

        return questions;
    };

    const getSkillName = async (skillId: string) => {
        const s = await prisma.mathSkill.findUnique({ where: { id: skillId }, select: { name: true } });
        return s?.name ?? 'Math';
    };

    // Section A + C: new skill (20 questions total, split 10+10)
    const newQuestions = await drawQuestions(newSkillId, 20);
    const newName = await getSkillName(newSkillId);
    const newInstruction = newQuestions[0]?.instruction ?? 'Solve the following.';

    // Section B: review skill 1 (10 questions)
    const review1Questions = await drawQuestions(review1Id, 10);
    const review1Name = await getSkillName(review1Id);
    const review1Instruction = review1Questions[0]?.instruction ?? 'Solve the following.';

    // Section D: review skill 2 (10 questions)
    const review2Questions = await drawQuestions(review2Id, 10);
    const review2Name = await getSkillName(review2Id);
    const review2Instruction = review2Questions[0]?.instruction ?? 'Solve the following.';

    return [
        {
            skillId: newSkillId,
            skillName: newName,
            instruction: newInstruction,
            questions: newQuestions.slice(0, 10).map(q => ({ question: q.question, answer: q.answer }))
        },
        {
            skillId: review1Id,
            skillName: review1Name,
            instruction: review1Instruction,
            questions: review1Questions.map(q => ({ question: q.question, answer: q.answer }))
        },
        {
            skillId: newSkillId,
            skillName: newName,
            instruction: newInstruction,
            questions: newQuestions.slice(10, 20).map(q => ({ question: q.question, answer: q.answer }))
        },
        {
            skillId: review2Id,
            skillName: review2Name,
            instruction: review2Instruction,
            questions: review2Questions.map(q => ({ question: q.question, answer: q.answer }))
        }
    ];
}
