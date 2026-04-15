import { Hono } from 'hono';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { validateJson } from '../validation';
import {
  createWorksheetTemplateSchema,
  updateWorksheetTemplateSchema,
  addTemplateImageSchema,
  addTemplateQuestionSchema,
  updateTemplateQuestionSchema,
  createMathSkillSchema,
} from '../schemas/worksheetTemplates';
import type { AppBindings } from '../types';

/**
 * Worksheet template + math skill + curriculum routes — port of
 * `backend/src/routes/worksheetTemplateRoutes.ts`.
 *
 * Three separate Hono instances because the Express side mounts these at
 * different top-level paths (`/api/worksheet-templates`, `/api/math-skills`,
 * `/api/worksheet-curriculum`).
 *
 * Mutation endpoints follow the same SUPERADMIN-only authorization as the
 * Express version. Image deletion + question CRUD use top-level paths
 * (`/images/:id`, `/questions/:id`) that are mounted under
 * `/api/worksheet-templates` to match the Express router exactly.
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

// ---------- Template mutations (mounted under /api/worksheet-templates) ----------
//
// These live on the same Hono instance as the read routes so the SUPERADMIN
// check applies via the per-route authorize middleware. We declare literal
// paths (`/images/:id`, `/questions/:id`) BEFORE the dynamic `/:id` GET so
// the param route does not swallow them.

const requireSuper = authorize([UserRole.SUPERADMIN]);

worksheetTemplateReadRoutes.delete('/images/:id', requireSuper, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const id = c.req.param('id');
  try {
    const image = await prisma.worksheetTemplateImage.findUnique({ where: { id } });
    if (!image) return c.json({ message: 'Template image not found' }, 404);
    await prisma.worksheetTemplateImage.delete({ where: { id } });
    return c.json({ message: 'Template image deleted successfully' }, 200);
  } catch (error) {
    console.error('Error deleting template image:', error);
    return c.json({ message: 'Server error while deleting template image' }, 500);
  }
});

worksheetTemplateReadRoutes.put(
  '/questions/:id',
  requireSuper,
  validateJson(updateTemplateQuestionSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const id = c.req.param('id');
    const { question, answer, outOf, skillIds } = c.req.valid('json');

    try {
      const existing = await prisma.worksheetTemplateQuestion.findUnique({
        where: { id },
        include: { skills: true },
      });
      if (!existing) return c.json({ message: 'Template question not found' }, 404);

      const updated = await prisma.worksheetTemplateQuestion.update({
        where: { id },
        data: {
          question: question || undefined,
          answer: answer || undefined,
          outOf: outOf !== undefined ? Number(outOf) : undefined,
          skills: skillIds
            ? { set: skillIds.map((skillId) => ({ id: skillId })) }
            : undefined,
        },
        include: { skills: true },
      });
      return c.json(updated, 200);
    } catch (error) {
      console.error('Error updating template question:', error);
      return c.json({ message: 'Server error while updating template question' }, 500);
    }
  }
);

worksheetTemplateReadRoutes.delete('/questions/:id', requireSuper, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const id = c.req.param('id');
  try {
    const existing = await prisma.worksheetTemplateQuestion.findUnique({ where: { id } });
    if (!existing) return c.json({ message: 'Template question not found' }, 404);
    await prisma.worksheetTemplateQuestion.delete({ where: { id } });
    return c.json({ message: 'Template question deleted successfully' }, 200);
  } catch (error) {
    console.error('Error deleting template question:', error);
    return c.json({ message: 'Server error while deleting template question' }, 500);
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

worksheetTemplateReadRoutes.post(
  '/',
  requireSuper,
  validateJson(createWorksheetTemplateSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const { worksheetNumber } = c.req.valid('json');

    try {
      if (worksheetNumber !== undefined && worksheetNumber !== null && worksheetNumber !== '') {
        const num = Number(worksheetNumber);
        const dup = await prisma.worksheetTemplate.findUnique({
          where: { worksheetNumber: num },
        });
        if (dup) {
          return c.json(
            { message: 'A template with this worksheet number already exists' },
            400
          );
        }
        const created = await prisma.worksheetTemplate.create({
          data: { worksheetNumber: num },
        });
        return c.json(created, 201);
      }
      const created = await prisma.worksheetTemplate.create({ data: {} });
      return c.json(created, 201);
    } catch (error) {
      console.error('Error creating worksheet template:', error);
      return c.json({ message: 'Server error while creating worksheet template' }, 500);
    }
  }
);

worksheetTemplateReadRoutes.put(
  '/:id',
  requireSuper,
  validateJson(updateWorksheetTemplateSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const id = c.req.param('id');
    const { worksheetNumber } = c.req.valid('json');

    try {
      const existing = await prisma.worksheetTemplate.findUnique({ where: { id } });
      if (!existing) return c.json({ message: 'Worksheet template not found' }, 404);

      const num =
        worksheetNumber !== undefined && worksheetNumber !== null && worksheetNumber !== ''
          ? Number(worksheetNumber)
          : null;

      if (num !== null && num !== existing.worksheetNumber) {
        const dup = await prisma.worksheetTemplate.findUnique({
          where: { worksheetNumber: num },
        });
        if (dup) {
          return c.json(
            { message: 'A template with this worksheet number already exists' },
            400
          );
        }
      }

      const updated = await prisma.worksheetTemplate.update({
        where: { id },
        data: { worksheetNumber: num },
      });
      return c.json(updated, 200);
    } catch (error) {
      console.error('Error updating worksheet template:', error);
      return c.json({ message: 'Server error while updating worksheet template' }, 500);
    }
  }
);

worksheetTemplateReadRoutes.delete('/:id', requireSuper, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const id = c.req.param('id');
  try {
    const tpl = await prisma.worksheetTemplate.findUnique({ where: { id } });
    if (!tpl) return c.json({ message: 'Worksheet template not found' }, 404);
    await prisma.worksheetTemplateImage.deleteMany({ where: { worksheetTemplateId: id } });
    await prisma.worksheetTemplate.delete({ where: { id } });
    return c.json({ message: 'Worksheet template deleted successfully' }, 200);
  } catch (error) {
    console.error('Error deleting worksheet template:', error);
    return c.json({ message: 'Server error while deleting worksheet template' }, 500);
  }
});

worksheetTemplateReadRoutes.post(
  '/:id/images',
  requireSuper,
  validateJson(addTemplateImageSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const id = c.req.param('id');
    const { imageUrl, pageNumber } = c.req.valid('json');

    try {
      const tpl = await prisma.worksheetTemplate.findUnique({ where: { id } });
      if (!tpl) return c.json({ message: 'Worksheet template not found' }, 404);

      const newImage = await prisma.worksheetTemplateImage.create({
        data: {
          imageUrl,
          pageNumber: Number(pageNumber),
          worksheetTemplateId: id,
        },
      });
      return c.json(newImage, 201);
    } catch (error) {
      console.error('Error adding template image:', error);
      return c.json({ message: 'Server error while adding template image' }, 500);
    }
  }
);

worksheetTemplateReadRoutes.post(
  '/:id/questions',
  requireSuper,
  validateJson(addTemplateQuestionSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const id = c.req.param('id');
    const { question, answer, outOf, skillIds } = c.req.valid('json');

    try {
      const tpl = await prisma.worksheetTemplate.findUnique({ where: { id } });
      if (!tpl) return c.json({ message: 'Worksheet template not found' }, 404);

      const created = await prisma.worksheetTemplateQuestion.create({
        data: {
          question,
          answer: answer ?? null,
          outOf: outOf !== undefined ? Number(outOf) : 1,
          worksheetTemplateId: id,
          worksheetTemplates: { connect: { id } },
          skills: skillIds
            ? { connect: skillIds.map((sid) => ({ id: sid })) }
            : undefined,
        },
        include: { skills: true },
      });
      return c.json(created, 201);
    } catch (error) {
      console.error('Error adding template question:', error);
      return c.json({ message: 'Server error while adding template question' }, 500);
    }
  }
);

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

mathSkillReadRoutes.post(
  '/',
  authorize([UserRole.SUPERADMIN]),
  validateJson(createMathSkillSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const { name, description, mainTopicId } = c.req.valid('json');
    try {
      const created = await prisma.mathSkill.create({
        data: { name, description, mainTopicId },
      });
      return c.json(created, 201);
    } catch (error) {
      console.error('Error creating math skill:', error);
      return c.json({ message: 'Server error while creating math skill' }, 500);
    }
  }
);

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
