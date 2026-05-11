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
    worksheetIds: string[];
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
    const studentClasses = await prisma.studentClass.findMany({
        where: { classId },
        select: { studentId: true }
    });

    return createBatchForStudents(
        classId,
        studentClasses.map(({ studentId }) => studentId),
        days,
        startDate
    );
}

/**
 * Create a queued worksheet batch for a single student.
 */
export async function createStudentBatch(
    studentId: string,
    days: number,
    startDate: Date
): Promise<BatchResult> {
    const studentClass = await prisma.studentClass.findFirst({
        where: { studentId },
        select: { classId: true }
    });

    if (!studentClass) {
        return { batchId: '', totalWorksheets: 0, skillsToGenerate: 0, worksheetIds: [], errors: ['Student is not assigned to a class'] };
    }

    return createBatchForStudents(studentClass.classId, [studentId], days, startDate);
}

async function createBatchForStudents(
    classId: string,
    studentIds: string[],
    days: number,
    startDate: Date
): Promise<BatchResult> {
    const errors: string[] = [];

    if (studentIds.length === 0) {
        return { batchId: '', totalWorksheets: 0, skillsToGenerate: 0, worksheetIds: [], errors: ['No students in class'] };
    }

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
    const worksheetIds: string[] = [];
    let totalWorksheets = 0;

    for (const studentId of studentIds) {
        const { plans, errors: planErrors } = await planWorksheets(studentId, days, startDate);
        errors.push(...planErrors);

        for (const plan of plans) {
            const worksheet = await prisma.generatedWorksheet.create({
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
            worksheetIds.push(worksheet.id);
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
        worksheetIds,
        errors
    };
}

/**
 * Called after question generation completes for a skill.
 *
 * **Idempotent under CF Queue at-least-once delivery.** The
 * question-generator Worker can re-deliver a `/store` message after a
 * successful but un-acked first call (or transient 5xx). Without a
 * dedup record, every replay double-increments `completedSkills`. We
 * insert into `BatchSkillProgress` first; the composite PK
 * `(batchId, mathSkillId)` makes the operation atomic — a duplicate raises
 * P2002, the caller skips the counter update, and returns `idempotent: true`.
 *
 * Mirrors the Hono adapter at `worker/adapters/batchProgress.ts` so both
 * runtimes write to the same dedup table during the parallel-run window.
 *
 * Checks if all skills for the batch are done, then assembles worksheets and enqueues PDFs.
 */
export async function onSkillQuestionsReady(
    batchId: string,
    mathSkillId: string
): Promise<{ idempotent: boolean }> {
    // 1. Atomic dedup insert. Composite PK fails on the second call for
    //    the same (batchId, mathSkillId) pair — that's our "already
    //    counted" signal.
    try {
        await prisma.batchSkillProgress.create({
            data: { batchId, mathSkillId }
        });
    } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') {
            // Already counted on a prior call (likely CF Queue redelivery).
            // Skip the counter update + assembly trigger.
            return { idempotent: true };
        }
        throw err;
    }

    // 2. First time — safe to increment.
    const batch = await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: { completedSkills: { increment: 1 } }
    });

    if (batch.completedSkills < batch.pendingSkills) return { idempotent: false };

    await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: { status: 'RENDERING_PDFS' }
    });

    await assembleAndEnqueuePdfs(batchId);
    return { idempotent: false };
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
