import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { planWorksheets } from './worksheetSchedulerService';
import { buildSections } from './worksheetGenerationService';
import {
    enqueueQuestionGeneration,
    createQuestionGenMessage
} from './queue/questionGenerationQueue';
import {
    enqueuePdfRendering,
    createPdfRenderMessage
} from './queue/pdfRenderingQueue';

interface BatchResult {
    batchId: string;
    totalWorksheets: number;
    skillsToGenerate: number;
    errors: string[];
}

/**
 * Create a batch of worksheets for an entire class.
 * Deduplicates skills, enqueues question generation for missing ones.
 */
export async function createClassBatch(
    classId: string,
    days: number,
    startDate: Date
): Promise<BatchResult> {
    const errors: string[] = [];

    // 1. Get all students in the class
    const studentClasses = await prisma.studentClass.findMany({
        where: { classId },
        select: { studentId: true }
    });

    if (studentClasses.length === 0) {
        return { batchId: '', totalWorksheets: 0, skillsToGenerate: 0, errors: ['No students in class'] };
    }

    // 2. Create the batch
    const batch = await prisma.worksheetBatch.create({
        data: {
            classId,
            days,
            startDate,
            status: 'PENDING',
            totalWorksheets: 0
        }
    });

    // 3. Plan worksheets for all students and create GeneratedWorksheet rows
    const allSkillIds = new Set<string>();
    let totalWorksheets = 0;

    for (const { studentId } of studentClasses) {
        const { plans, errors: planErrors } = await planWorksheets(studentId, days, startDate);
        errors.push(...planErrors);

        for (const plan of plans) {
            await prisma.generatedWorksheet.create({
                data: {
                    studentId,
                    scheduledDate: plan.scheduledDate,
                    newSkillId: plan.newSkillId,
                    reviewSkill1Id: plan.reviewSkill1Id,
                    reviewSkill2Id: plan.reviewSkill2Id,
                    batchId: batch.id,
                    status: 'PENDING'
                }
            });
            totalWorksheets++;
            allSkillIds.add(plan.newSkillId);
            allSkillIds.add(plan.reviewSkill1Id);
            allSkillIds.add(plan.reviewSkill2Id);
        }
    }

    // 4. Deduplicate: find which skills need question generation
    const skillsNeedingGeneration: { id: string; name: string; topicName: string }[] = [];
    for (const skillId of allSkillIds) {
        const count = await prisma.questionBank.count({ where: { mathSkillId: skillId } });
        if (count >= 30) continue;

        const skill = await prisma.mathSkill.findUnique({
            where: { id: skillId },
            include: { mainTopic: true }
        });
        if (!skill) continue;

        skillsNeedingGeneration.push({
            id: skill.id,
            name: skill.name,
            topicName: skill.mainTopic?.name ?? 'Math'
        });
    }

    // 5. Update batch with counts
    await prisma.worksheetBatch.update({
        where: { id: batch.id },
        data: {
            totalWorksheets,
            pendingSkills: skillsNeedingGeneration.length,
            status: skillsNeedingGeneration.length > 0 ? 'GENERATING_QUESTIONS' : 'RENDERING_PDFS'
        }
    });

    // 6. If no skills need generation, go straight to assembling + PDF
    if (skillsNeedingGeneration.length === 0) {
        await assembleAndEnqueuePdfs(batch.id);
    } else {
        // 7. Enqueue question generation for each skill
        for (const skill of skillsNeedingGeneration) {
            try {
                const msg = createQuestionGenMessage(skill.id, skill.name, skill.topicName, 30, batch.id);
                await enqueueQuestionGeneration(msg);
            } catch (err) {
                errors.push(`Failed to enqueue generation for ${skill.name}: ${err}`);
            }
        }
    }

    return {
        batchId: batch.id,
        totalWorksheets,
        skillsToGenerate: skillsNeedingGeneration.length,
        errors
    };
}

/**
 * Called after question generation completes for a skill.
 * Checks if all skills for the batch are done, then assembles worksheets and enqueues PDFs.
 */
export async function onSkillQuestionsReady(batchId: string): Promise<void> {
    const batch = await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: { completedSkills: { increment: 1 } }
    });

    if (batch.completedSkills < batch.pendingSkills) return;

    await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: { status: 'RENDERING_PDFS' }
    });

    await assembleAndEnqueuePdfs(batchId);
}

/**
 * Assemble sectionsJson for all PENDING worksheets in a batch, then enqueue PDF rendering.
 */
async function assembleAndEnqueuePdfs(batchId: string): Promise<void> {
    const worksheets = await prisma.generatedWorksheet.findMany({
        where: { batchId, status: 'PENDING' }
    });

    for (const ws of worksheets) {
        try {
            const sections = await buildSections(ws.newSkillId, ws.reviewSkill1Id, ws.reviewSkill2Id);
            await prisma.generatedWorksheet.update({
                where: { id: ws.id },
                data: {
                    sectionsJson: sections as unknown as Prisma.InputJsonValue,
                    status: 'QUESTIONS_READY'
                }
            });

            const msg = createPdfRenderMessage(ws.id, batchId);
            await enqueuePdfRendering(msg);
        } catch (err) {
            console.error(`[batch] Failed to assemble worksheet ${ws.id}:`, err);
            await prisma.generatedWorksheet.update({
                where: { id: ws.id },
                data: { status: 'FAILED' }
            });
            await prisma.worksheetBatch.update({
                where: { id: batchId },
                data: { failedWorksheets: { increment: 1 } }
            });
        }
    }
}

/**
 * Called when a PDF rendering completes for a worksheet.
 * Updates batch progress, marks batch complete when all done.
 */
export async function onWorksheetPdfComplete(batchId: string, failed: boolean): Promise<void> {
    const updateData = failed
        ? { failedWorksheets: { increment: 1 } }
        : { completedWorksheets: { increment: 1 } };

    const batch = await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: updateData
    });

    const totalDone = batch.completedWorksheets + batch.failedWorksheets;
    if (totalDone >= batch.totalWorksheets) {
        await prisma.worksheetBatch.update({
            where: { id: batchId },
            data: { status: 'COMPLETED' }
        });
    }
}
