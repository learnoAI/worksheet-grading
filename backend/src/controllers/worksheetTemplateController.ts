import { Request, Response } from 'express';
import prisma from '../utils/prisma';

/**
 * Get all worksheet templates
 * @route GET /api/worksheet-templates
 */
export const getAllWorksheetTemplates = async (req: Request, res: Response) => {
    try {
        const templates = await prisma.worksheetTemplate.findMany({
            include: {
                worksheetImages: true,
                questions: {
                    include: {
                        skills: true
                    }
                }
            }
        });

        return res.status(200).json(templates);
    } catch (error) {
        console.error('Error fetching worksheet templates:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheet templates' });
    }
};

/**
 * Get a specific worksheet template by ID
 * @route GET /api/worksheet-templates/:id
 */
export const getWorksheetTemplateById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const template = await prisma.worksheetTemplate.findUnique({
            where: { id },
            include: {
                worksheetImages: true,
                questions: {
                    include: {
                        skills: true
                    }
                }
            }
        });

        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }

        return res.status(200).json(template);
    } catch (error) {
        console.error('Error fetching worksheet template:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheet template' });
    }
};

/**
 * Create a new worksheet template
 * @route POST /api/worksheet-templates
 */
export const createWorksheetTemplate = async (req: Request, res: Response) => {
    const { worksheetNumber } = req.body;

    try {
        // Check if the worksheet number already exists
        if (worksheetNumber) {
            const existingTemplate = await prisma.worksheetTemplate.findUnique({
                where: { worksheetNumber: Number(worksheetNumber) }
            });

            if (existingTemplate) {
                return res.status(400).json({ message: 'A template with this worksheet number already exists' });
            }
        }

        // Create the new template
        const newTemplate = await prisma.worksheetTemplate.create({
            data: {
                worksheetNumber: worksheetNumber ? Number(worksheetNumber) : undefined
            }
        });

        return res.status(201).json(newTemplate);
    } catch (error) {
        console.error('Error creating worksheet template:', error);
        return res.status(500).json({ message: 'Server error while creating worksheet template' });
    }
};

/**
 * Update a worksheet template
 * @route PUT /api/worksheet-templates/:id
 */
export const updateWorksheetTemplate = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { worksheetNumber } = req.body;

    try {
        // Check if the template exists
        const existingTemplate = await prisma.worksheetTemplate.findUnique({
            where: { id }
        });

        if (!existingTemplate) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }

        // Check if the new worksheet number already exists
        if (worksheetNumber && worksheetNumber !== existingTemplate.worksheetNumber) {
            const duplicateNumber = await prisma.worksheetTemplate.findUnique({
                where: { worksheetNumber: Number(worksheetNumber) }
            });

            if (duplicateNumber) {
                return res.status(400).json({ message: 'A template with this worksheet number already exists' });
            }
        }

        // Update the template
        const updatedTemplate = await prisma.worksheetTemplate.update({
            where: { id },
            data: {
                worksheetNumber: worksheetNumber ? Number(worksheetNumber) : null
            }
        });

        return res.status(200).json(updatedTemplate);
    } catch (error) {
        console.error('Error updating worksheet template:', error);
        return res.status(500).json({ message: 'Server error while updating worksheet template' });
    }
};

/**
 * Delete a worksheet template
 * @route DELETE /api/worksheet-templates/:id
 */
export const deleteWorksheetTemplate = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if the template exists
        const template = await prisma.worksheetTemplate.findUnique({
            where: { id }
        });

        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }

        // Delete all associated images and questions
        await prisma.worksheetTemplateImage.deleteMany({
            where: { worksheetTemplateId: id }
        });

        // Delete the template
        await prisma.worksheetTemplate.delete({
            where: { id }
        });

        return res.status(200).json({ message: 'Worksheet template deleted successfully' });
    } catch (error) {
        console.error('Error deleting worksheet template:', error);
        return res.status(500).json({ message: 'Server error while deleting worksheet template' });
    }
};

/**
 * Add an image to a worksheet template
 * @route POST /api/worksheet-templates/:id/images
 */
export const addTemplateImage = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { imageUrl, pageNumber } = req.body;

    try {
        // Check if the template exists
        const template = await prisma.worksheetTemplate.findUnique({
            where: { id }
        });

        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }

        // Create the image
        const newImage = await prisma.worksheetTemplateImage.create({
            data: {
                imageUrl,
                pageNumber: Number(pageNumber),
                worksheetTemplateId: id
            }
        });

        return res.status(201).json(newImage);
    } catch (error) {
        console.error('Error adding template image:', error);
        return res.status(500).json({ message: 'Server error while adding template image' });
    }
};

/**
 * Delete an image from a worksheet template
 * @route DELETE /api/worksheet-templates/images/:id
 */
export const deleteTemplateImage = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if the image exists
        const image = await prisma.worksheetTemplateImage.findUnique({
            where: { id }
        });

        if (!image) {
            return res.status(404).json({ message: 'Template image not found' });
        }

        // Delete the image
        await prisma.worksheetTemplateImage.delete({
            where: { id }
        });

        return res.status(200).json({ message: 'Template image deleted successfully' });
    } catch (error) {
        console.error('Error deleting template image:', error);
        return res.status(500).json({ message: 'Server error while deleting template image' });
    }
};

/**
 * Add a question to a worksheet template
 * @route POST /api/worksheet-templates/:id/questions
 */
export const addTemplateQuestion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { question, answer, outOf, skillIds } = req.body;

    try {
        // Check if the template exists
        const template = await prisma.worksheetTemplate.findUnique({
            where: { id }
        });

        if (!template) {
            return res.status(404).json({ message: 'Worksheet template not found' });
        }

        // Create the question
        const newQuestion = await prisma.worksheetTemplateQuestion.create({
            data: {
                question,
                answer,
                outOf: outOf ? Number(outOf) : 1,
                worksheetTemplateId: id,
                worksheetTemplates: {
                    connect: { id }
                },
                skills: skillIds ? {
                    connect: skillIds.map((skillId: string) => ({ id: skillId }))
                } : undefined
            },
            include: {
                skills: true
            }
        });

        return res.status(201).json(newQuestion);
    } catch (error) {
        console.error('Error adding template question:', error);
        return res.status(500).json({ message: 'Server error while adding template question' });
    }
};

/**
 * Update a template question
 * @route PUT /api/worksheet-templates/questions/:id
 */
export const updateTemplateQuestion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { question, answer, outOf, skillIds } = req.body;

    try {
        // Check if the question exists
        const existingQuestion = await prisma.worksheetTemplateQuestion.findUnique({
            where: { id },
            include: { skills: true }
        });

        if (!existingQuestion) {
            return res.status(404).json({ message: 'Template question not found' });
        }

        // Update the question
        const updatedQuestion = await prisma.worksheetTemplateQuestion.update({
            where: { id },
            data: {
                question: question || undefined,
                answer: answer || undefined,
                outOf: outOf ? Number(outOf) : undefined,
                skills: skillIds ? {
                    set: skillIds.map((skillId: string) => ({ id: skillId }))
                } : undefined
            },
            include: {
                skills: true
            }
        });

        return res.status(200).json(updatedQuestion);
    } catch (error) {
        console.error('Error updating template question:', error);
        return res.status(500).json({ message: 'Server error while updating template question' });
    }
};

/**
 * Delete a template question
 * @route DELETE /api/worksheet-templates/questions/:id
 */
export const deleteTemplateQuestion = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if the question exists
        const question = await prisma.worksheetTemplateQuestion.findUnique({
            where: { id }
        });

        if (!question) {
            return res.status(404).json({ message: 'Template question not found' });
        }

        // Delete the question
        await prisma.worksheetTemplateQuestion.delete({
            where: { id }
        });

        return res.status(200).json({ message: 'Template question deleted successfully' });
    } catch (error) {
        console.error('Error deleting template question:', error);
        return res.status(500).json({ message: 'Server error while deleting template question' });
    }
};

/**
 * Get worksheet-to-curriculum mappings
 * @route GET /api/worksheet-curriculum
 */
export const getWorksheetCurriculumMappings = async (req: Request, res: Response) => {
    try {
        const worksheetNumbersParam = req.query.worksheetNumbers;
        let worksheetNumbers: number[] | undefined;

        if (typeof worksheetNumbersParam === 'string' && worksheetNumbersParam.trim().length > 0) {
            const parsedNumbers = worksheetNumbersParam
                .split(',')
                .map((value) => value.trim())
                .filter((value) => value.length > 0)
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => Number.isInteger(value) && value > 0);

            const uniqueNumbers = [...new Set(parsedNumbers)];

            if (uniqueNumbers.length === 0) {
                return res.status(400).json({ message: 'worksheetNumbers must contain at least one positive integer' });
            }

            worksheetNumbers = uniqueNumbers;
        }

        const mappings = await prisma.worksheetSkillMap.findMany({
            where: worksheetNumbers
                ? {
                    worksheetNumber: {
                        in: worksheetNumbers
                    }
                }
                : undefined,
            include: {
                mathSkill: {
                    include: {
                        mainTopic: true
                    }
                }
            },
            orderBy: {
                worksheetNumber: 'asc'
            }
        });

        const response = mappings.map((mapping) => ({
            worksheetNumber: mapping.worksheetNumber,
            isTest: mapping.isTest,
            learningOutcome: {
                id: mapping.mathSkill.id,
                name: mapping.mathSkill.name
            },
            mainTopic: mapping.mathSkill.mainTopic
                ? {
                    id: mapping.mathSkill.mainTopic.id,
                    name: mapping.mathSkill.mainTopic.name
                }
                : null
        }));

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error fetching worksheet curriculum mappings:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheet curriculum mappings' });
    }
};

/**
 * Get all math skills
 * @route GET /api/math-skills
 */
export const getAllMathSkills = async (req: Request, res: Response) => {
    try {
        const skills = await prisma.mathSkill.findMany({
            include: {
                mainTopic: true
            }
        });
        return res.status(200).json(skills);
    } catch (error) {
        console.error('Error fetching math skills:', error);
        return res.status(500).json({ message: 'Server error while retrieving math skills' });
    }
};

/**
 * Create a new math skill
 * @route POST /api/math-skills
 */
export const createMathSkill = async (req: Request, res: Response) => {
    const { name, description, mainTopicId } = req.body;

    try {
        const newSkill = await prisma.mathSkill.create({
            data: {
                name,
                description,
                mainTopicId
            }
        });

        return res.status(201).json(newSkill);
    } catch (error) {
        console.error('Error creating math skill:', error);
        return res.status(500).json({ message: 'Server error while creating math skill' });
    }
}; 
