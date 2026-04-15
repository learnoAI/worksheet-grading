import { Hono } from 'hono';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * Worksheet template + math skill + curriculum read routes — port of the
 * GET handlers in `backend/src/routes/worksheetTemplateRoutes.ts`.
 *
 * Three separate Hono instances because the Express side mounts these at
 * different top-level paths (`/api/worksheet-templates`, `/api/math-skills`,
 * `/api/worksheet-curriculum`). Keeping the paths flat here matches what
 * clients already call.
 *
 * Mutation endpoints (create/update/delete templates, skills, questions,
 * images, CSV uploads) come in Phase 5.7 / 5.8.
 */

const TEMPLATE_INCLUDE = {
  worksheetImages: true,
  questions: { include: { skills: true } },
} as const;

export const worksheetTemplateReadRoutes = new Hono<AppBindings>();
worksheetTemplateReadRoutes.use('*', authenticate);

worksheetTemplateReadRoutes.get('/', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  try {
    const rows = await prisma.worksheetTemplate.findMany({ include: TEMPLATE_INCLUDE });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error fetching worksheet templates:', error);
    return c.json({ message: 'Server error while retrieving worksheet templates' }, 500);
  }
});

worksheetTemplateReadRoutes.get('/:id', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const id = c.req.param('id');
  try {
    const row = await prisma.worksheetTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!row) return c.json({ message: 'Worksheet template not found' }, 404);
    return c.json(row, 200);
  } catch (error) {
    console.error('Error fetching worksheet template:', error);
    return c.json({ message: 'Server error while retrieving worksheet template' }, 500);
  }
});

export const mathSkillReadRoutes = new Hono<AppBindings>();
mathSkillReadRoutes.use('*', authenticate);

mathSkillReadRoutes.get('/', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  try {
    const rows = await prisma.mathSkill.findMany({ include: { mainTopic: true } });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error fetching math skills:', error);
    return c.json({ message: 'Server error while retrieving math skills' }, 500);
  }
});

export const worksheetCurriculumReadRoutes = new Hono<AppBindings>();
worksheetCurriculumReadRoutes.use('*', authenticate);
worksheetCurriculumReadRoutes.use(
  '*',
  authorize([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN])
);

worksheetCurriculumReadRoutes.get('/', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const param = c.req.query('worksheetNumbers');
  let worksheetNumbers: number[] | undefined;

  if (typeof param === 'string' && param.trim().length > 0) {
    const parsed = param
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map((v) => Number.parseInt(v, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    const unique = [...new Set(parsed)];
    if (unique.length === 0) {
      return c.json(
        { message: 'worksheetNumbers must contain at least one positive integer' },
        400
      );
    }
    worksheetNumbers = unique;
  }

  try {
    const rows = await prisma.worksheetSkillMap.findMany({
      where: worksheetNumbers ? { worksheetNumber: { in: worksheetNumbers } } : undefined,
      include: { mathSkill: { include: { mainTopic: true } } },
      orderBy: { worksheetNumber: 'asc' },
    });

    const response = rows.map((m) => ({
      worksheetNumber: m.worksheetNumber,
      isTest: m.isTest,
      learningOutcome: { id: m.mathSkill.id, name: m.mathSkill.name },
      mainTopic: m.mathSkill.mainTopic
        ? { id: m.mathSkill.mainTopic.id, name: m.mathSkill.mainTopic.name }
        : null,
    }));

    return c.json(response, 200);
  } catch (error) {
    console.error('Error fetching worksheet curriculum mappings:', error);
    return c.json(
      { message: 'Server error while retrieving worksheet curriculum mappings' },
      500
    );
  }
});
