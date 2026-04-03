import { Request, Response } from "express";
import { validationResult } from "express-validator";
import prisma from "../utils/prisma";
import { uploadToS3 } from "../services/s3Service";
import { enqueueWorksheet } from "../services/queueService";
import { GradingJobStatus, Prisma, ProcessingStatus } from "@prisma/client";
import fetch from "node-fetch";
import { buildWorksheetRecommendationFromHistory } from "../services/worksheetRecommendation";

interface MulterFile extends Express.Multer.File {}

function getEffectiveWorksheetNumber(
  worksheetNumber: number | null | undefined,
  templateWorksheetNumber: number | null | undefined,
): number | null {
  if (typeof worksheetNumber === "number" && worksheetNumber > 0) {
    return worksheetNumber;
  }

  if (
    typeof templateWorksheetNumber === "number" &&
    templateWorksheetNumber > 0
  ) {
    return templateWorksheetNumber;
  }

  return null;
}

function getFirstPositiveNumber(
  ...values: Array<number | null | undefined>
): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function parseWorksheetNumberFromNotes(
  notes: string | null | undefined,
): number | null {
  if (!notes) {
    return null;
  }

  const match = notes.match(/worksheet\s*#?\s*(\d+)/i);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDateInputToUtcStart(dateInput: string): Date | null {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

function parseDateInputToUtcEndExclusive(dateInput: string): Date | null {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  }

  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}

/**
 * Upload a worksheet with multiple images
 * @route POST /api/worksheets/upload
 */
export const uploadWorksheet = async (req: Request, res: Response) => {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Check if files were uploaded
  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    return res.status(400).json({ message: "No files uploaded" });
  }

  const { classId, studentId, notes } = req.body;
  // Access files array directly
  const files = req.files as MulterFile[];

  try {
    // Check if class exists
    const classExists = await prisma.class.findUnique({
      where: { id: classId },
    });

    if (!classExists) {
      return res.status(404).json({ message: "Class not found" });
    }

    // If studentId is provided, check if student exists
    if (studentId) {
      const student = await prisma.user.findFirst({
        where: {
          id: studentId,
          role: "STUDENT",
          studentClasses: {
            some: {
              classId,
            },
          },
        },
      });

      if (!student) {
        return res
          .status(404)
          .json({ message: "Student not found in this class" });
      }
    }

    // Create worksheet record
    const worksheet = await prisma.worksheet.create({
      data: {
        notes: notes || null,
        status: ProcessingStatus.PENDING,
        submittedById: req.user!.userId,
        classId,
        studentId: studentId || null,
      },
    });

    // Upload each file to S3 and create WorksheetImage records
    const imagePromises = files.map(async (file: MulterFile, index: number) => {
      // Get page number from the request or use the index
      const pageNumber =
        req.body.pageNumbers && Array.isArray(req.body.pageNumbers)
          ? parseInt(req.body.pageNumbers[index] as string)
          : index + 1;

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `worksheets/${worksheet.id}/${timestamp}-page${pageNumber}-${file.originalname.replace(/\s+/g, "_")}`;

      // Upload to S3
      const imageUrl = await uploadToS3(file.buffer, filename, file.mimetype);

      // Create WorksheetImage record
      return prisma.worksheetImage.create({
        data: {
          imageUrl,
          pageNumber,
          worksheetId: worksheet.id,
        },
      });
    });

    // Wait for all images to be uploaded and records created
    const worksheetImages = await Promise.all(imagePromises);

    // Enqueue for processing
    await enqueueWorksheet(worksheet.id);

    return res.status(201).json({
      id: worksheet.id,
      images: worksheetImages,
      status: worksheet.status,
      message: "Worksheet uploaded and queued for processing",
    });
  } catch (error) {
    console.error("Worksheet upload error:", error);
    return res
      .status(500)
      .json({ message: "Server error during worksheet upload" });
  }
};

/**
 * Get all worksheets for a class
 * @route GET /api/worksheets/class/:classId
 */
export const getWorksheetsByClass = async (req: Request, res: Response) => {
  const { classId } = req.params;

  try {
    const worksheets = await prisma.worksheet.findMany({
      where: { classId },
      include: {
        submittedBy: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
        class: {
          select: {
            id: true,
            name: true,
          },
        },
        images: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json(worksheets);
  } catch (error) {
    console.error("Get worksheets by class error:", error);
    return res
      .status(500)
      .json({ message: "Server error while retrieving worksheets" });
  }
};

/**
 * Get all worksheets for a student
 * @route GET /api/worksheets/student/:studentId
 */
export const getWorksheetsByStudent = async (req: Request, res: Response) => {
  const { studentId } = req.params;

  try {
    // First check if student exists
    const student = await prisma.user.findFirst({
      where: {
        id: studentId,
        role: "STUDENT",
      },
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const worksheets = await prisma.worksheet.findMany({
      where: { studentId },
      include: {
        submittedBy: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
        class: {
          select: {
            id: true,
            name: true,
          },
        },
        template: {
          select: {
            id: true,
            worksheetNumber: true,
          },
        },
        images: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json(worksheets);
  } catch (error) {
    console.error("Get worksheets by student error:", error);
    return res
      .status(500)
      .json({ message: "Server error while retrieving worksheets" });
  }
};

/**
 * Get a specific worksheet by ID
 * @route GET /api/worksheets/:id
 */
export const getWorksheetById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const worksheet = await prisma.worksheet.findUnique({
      where: { id },
      include: {
        submittedBy: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
        class: {
          select: {
            id: true,
            name: true,
          },
        },
        template: {
          select: {
            id: true,
            worksheetNumber: true,
          },
        },
        images: true,
      },
    });

    if (!worksheet) {
      return res.status(404).json({ message: "Worksheet not found" });
    }

    return res.status(200).json(worksheet);
  } catch (error) {
    console.error("Get worksheet by ID error:", error);
    return res
      .status(500)
      .json({ message: "Server error while retrieving worksheet" });
  }
};

// Get classes for a teacher
export const getTeacherClasses = async (req: Request, res: Response) => {
  const { teacherId } = req.params;
  const classes = await prisma.teacherClass.findMany({
    where: {
      teacherId: teacherId,
      class: {
        isArchived: false, // Filter out archived classes
      },
    },
    include: {
      class: {
        include: {
          school: true,
        },
      },
    },
  });

  // Transform the data to match the frontend's needs
  const transformedClasses = classes.map((tc) => ({
    id: tc.class.id,
    name: `${tc.class.school.name} - ${tc.class.name}`,
  }));

  res.json(transformedClasses);
};

// Get students in a class
export const getClassStudents = async (req: Request, res: Response) => {
  const { classId } = req.params;

  const students = await prisma.studentClass.findMany({
    where: {
      classId: classId,
      student: {
        isArchived: false,
      },
    },
    include: {
      student: {
        select: {
          id: true,
          username: true,
          name: true,
          tokenNumber: true,
        },
      },
    },
  });

  // Transform the data to match the frontend's needs
  const transformedStudents = students.map((sc) => ({
    id: sc.student.id,
    username: sc.student.username,
    name: sc.student.name,
    tokenNumber: sc.student.tokenNumber,
  }));

  res.json(transformedStudents);
};

// Get worksheet templates
export const getWorksheetTemplates = async (req: Request, res: Response) => {
  const templates = await prisma.worksheetTemplate.findMany({
    select: {
      id: true,
      worksheetNumber: true,
    },
    orderBy: {
      worksheetNumber: "asc",
    },
  });

  res.json(templates);
};

// Create a graded worksheet
export const createGradedWorksheet = async (req: Request, res: Response) => {
  const {
    classId,
    studentId,
    worksheetNumber,
    grade,
    notes,
    submittedOn,
    isAbsent,
    isRepeated,
    isIncorrectGrade,
    gradingDetails,
    wrongQuestionNumbers,
  } = req.body;
  const submittedById = req.user?.userId;

  // Normalize submittedOn to midnight UTC for consistent unique constraint matching
  const submittedOnDate = submittedOn ? new Date(submittedOn) : new Date();
  submittedOnDate.setUTCHours(0, 0, 0, 0);

  try {
    // If student is absent, create a record marking them as absent
    if (isAbsent) {
      // Use upsert to prevent duplicates for absent records
      // worksheetNumber = 0 for absent students
      const worksheet = await prisma.worksheet.upsert({
        where: {
          unique_worksheet_per_student_day: {
            studentId,
            classId,
            worksheetNumber: 0,
            submittedOn: submittedOnDate,
          },
        },
        update: {
          grade: 0,
          notes: notes || "Student absent",
          status: ProcessingStatus.COMPLETED,
          isAbsent: true,
          worksheetNumber: 0,
        },
        create: {
          classId,
          studentId,
          submittedById: submittedById!,
          worksheetNumber: 0,
          grade: 0,
          notes: notes || "Student absent",
          status: ProcessingStatus.COMPLETED,
          outOf: 40,
          submittedOn: submittedOnDate,
          isAbsent: true,
          isRepeated: false,
          isIncorrectGrade: false,
        },
      });

      return res.status(201).json(worksheet);
    }

    // For non-absent students, handle normally
    // Make sure worksheetNumber is a valid number
    const worksheetNum = Number(worksheetNumber);
    if (isNaN(worksheetNum) || worksheetNum <= 0) {
      return res.status(400).json({
        message: "Valid worksheet number is required for non-absent students",
      });
    }

    // Make sure grade is a valid number
    const gradeValue = Number(grade);
    if (isNaN(gradeValue) || gradeValue < 0 || gradeValue > 40) {
      return res.status(400).json({
        message:
          "Valid grade between 0 and 40 is required for non-absent students",
      });
    }

    // Find the template by worksheet number for non-absent students
    const template = await prisma.worksheetTemplate.findFirst({
      where: {
        worksheetNumber: worksheetNum,
      },
    });

    // Use upsert to prevent duplicates from race conditions
    const worksheet = await prisma.worksheet.upsert({
      where: {
        unique_worksheet_per_student_day: {
          studentId,
          classId,
          worksheetNumber: worksheetNum,
          submittedOn: submittedOnDate,
        },
      },
      update: {
        grade: gradeValue,
        notes,
        status: ProcessingStatus.COMPLETED,
        isIncorrectGrade: isIncorrectGrade || false,
        isRepeated: isRepeated || false,
        gradingDetails: gradingDetails || null,
        wrongQuestionNumbers: wrongQuestionNumbers || null,
        worksheetNumber: worksheetNum,
      },
      create: {
        classId,
        studentId,
        submittedById: submittedById!,
        templateId: template?.id,
        worksheetNumber: worksheetNum,
        grade: gradeValue,
        notes,
        status: ProcessingStatus.COMPLETED,
        outOf: 40,
        submittedOn: submittedOnDate,
        isAbsent: false,
        isRepeated: isRepeated || false,
        isIncorrectGrade: isIncorrectGrade || false,
        gradingDetails: gradingDetails || null,
        wrongQuestionNumbers: wrongQuestionNumbers || null,
      },
    });

    res.status(201).json(worksheet);
  } catch (error) {
    console.error("Create graded worksheet error:", error);
    return res
      .status(500)
      .json({ message: "Server error while creating worksheet" });
  }
};

// Find worksheet by class, student, and date range
export const findWorksheetByClassStudentDate = async (
  req: Request,
  res: Response,
) => {
  const { classId, studentId, startDate, endDate } = req.query;

  if (!classId || !studentId || !startDate || !endDate) {
    return res
      .status(400)
      .json({ message: "Missing required query parameters" });
  }

  try {
    const worksheet = await prisma.worksheet.findFirst({
      where: {
        classId: classId as string,
        studentId: studentId as string,
        submittedOn: {
          gte: new Date(startDate as string),
          lt: new Date(endDate as string),
        },
      },
      include: {
        submittedBy: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
        class: {
          select: {
            id: true,
            name: true,
          },
        },
        template: true,
      },
    });

    return res.status(200).json(worksheet);
  } catch (error) {
    console.error("Find worksheet error:", error);
    return res
      .status(500)
      .json({ message: "Server error while finding worksheet" });
  }
};

// Find ALL worksheets by class, student, and date range (for multiple worksheets per day)
export const findAllWorksheetsByClassStudentDate = async (
  req: Request,
  res: Response,
) => {
  const { classId, studentId, startDate, endDate } = req.query;

  if (!classId || !studentId || !startDate || !endDate) {
    return res
      .status(400)
      .json({ message: "Missing required query parameters" });
  }

  try {
    const worksheets = await prisma.worksheet.findMany({
      where: {
        classId: classId as string,
        studentId: studentId as string,
        submittedOn: {
          gte: new Date(startDate as string),
          lt: new Date(endDate as string),
        },
      },
      include: {
        submittedBy: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
        class: {
          select: {
            id: true,
            name: true,
          },
        },
        template: true,
        images: {
          orderBy: {
            pageNumber: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return res.status(200).json(worksheets);
  } catch (error) {
    console.error("Find all worksheets error:", error);
    return res
      .status(500)
      .json({ message: "Server error while finding worksheets" });
  }
};

// Update a graded worksheet
export const updateGradedWorksheet = async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    classId,
    studentId,
    worksheetNumber,
    grade,
    notes,
    submittedOn,
    isAbsent,
    isRepeated,
    isIncorrectGrade,
    gradingDetails,
    wrongQuestionNumbers,
  } = req.body;
  const submittedById = req.user?.userId;

  try {
    // Find the existing worksheet
    const existingWorksheet = await prisma.worksheet.findUnique({
      where: { id },
    });

    if (!existingWorksheet) {
      return res.status(404).json({ message: "No worksheet found to update" });
    }

    // If student is marked as absent, completely clear all grade data
    if (isAbsent) {
      const worksheet = await prisma.worksheet.update({
        where: { id },
        data: {
          class: {
            connect: { id: classId },
          },
          student: {
            connect: { id: studentId },
          },
          submittedBy: {
            connect: { id: submittedById! },
          },
          grade: 0, // Force zero grade for absent student
          notes: notes || "Student absent",
          status: ProcessingStatus.COMPLETED,
          outOf: 40,
          template: {
            disconnect: true, // Remove template association
          },
          submittedOn: submittedOn ? new Date(submittedOn) : undefined,
          isAbsent: true,
          isRepeated: false, // Can't be repeated if absent
          isIncorrectGrade: false, // Absent students can't have incorrect grades
          gradingDetails: Prisma.DbNull,
          wrongQuestionNumbers: null,
        },
      });

      return res.status(200).json(worksheet);
    }

    // For non-absent students, handle normally
    // Make sure worksheetNumber is a valid number
    const worksheetNum = Number(worksheetNumber);
    if (isNaN(worksheetNum) || worksheetNum <= 0) {
      return res.status(400).json({
        message: "Valid worksheet number is required for non-absent students",
      });
    }

    // Make sure grade is a valid number
    const gradeValue = Number(grade);
    if (isNaN(gradeValue) || gradeValue < 0 || gradeValue > 40) {
      return res.status(400).json({
        message:
          "Valid grade between 0 and 40 is required for non-absent students",
      });
    }

    // Find the template by worksheet number
    const template = await prisma.worksheetTemplate.findFirst({
      where: {
        worksheetNumber: worksheetNum,
      },
    });

    if (!template) {
    }

    const data = {
      class: {
        connect: { id: classId },
      },
      student: {
        connect: { id: studentId },
      },
      submittedBy: {
        connect: { id: submittedById! },
      },
      grade: gradeValue,
      worksheetNumber: worksheetNum,
      notes,
      status: ProcessingStatus.COMPLETED,
      outOf: 40,
      ...(template
        ? {
            template: {
              connect: { id: template.id },
            },
          }
        : {}),
      submittedOn: submittedOn ? new Date(submittedOn) : undefined,
      isAbsent: false,
      isRepeated: isRepeated || false,
      isIncorrectGrade: isIncorrectGrade || false,
      gradingDetails:
        gradingDetails === undefined
          ? existingWorksheet.gradingDetails
          : gradingDetails || null,
      wrongQuestionNumbers:
        wrongQuestionNumbers === undefined
          ? existingWorksheet.wrongQuestionNumbers
          : wrongQuestionNumbers || null,
    };

    const worksheet = await prisma.worksheet.update({
      where: { id },
      data,
    });

    res.status(200).json(worksheet);
  } catch (error) {
    console.error("Update graded worksheet error:", error);
    return res
      .status(500)
      .json({ message: "Server error while updating worksheet" });
  }
};

export const deleteGradedWorksheet = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.worksheet.delete({
      where: { id },
    });

    return res.status(200).json({ message: "Worksheet deleted successfully" });
  } catch (error) {
    console.error("Delete graded worksheet error:", error);
    return res
      .status(500)
      .json({ message: "Server error while deleting worksheet" });
  }
};

export const getPreviousWorksheets = async (req: Request, res: Response) => {
  const { classId, studentId, endDate } = req.query;

  if (!classId || !studentId || !endDate) {
    return res
      .status(400)
      .json({ message: "Missing required query parameters" });
  }

  try {
    const endDateObj = new Date(endDate as string);
    const currentDate = new Date();

    const isFutureDate = endDateObj > currentDate;

    const worksheets = await prisma.worksheet.findMany({
      where: {
        classId: classId as string,
        studentId: studentId as string,
        ...(isFutureDate
          ? {}
          : {
              submittedOn: {
                lt: endDateObj,
              },
            }),
        status: ProcessingStatus.COMPLETED,
      },
      include: {
        template: true,
      },
      orderBy: {
        submittedOn: "desc",
      },
    });

    return res.status(200).json(worksheets);
  } catch (error) {
    console.error("Get previous worksheets error:", error);
    return res
      .status(500)
      .json({ message: "Server error while retrieving previous worksheets" });
  }
};

/**
 * Get all worksheets for a class on a specific date
 * @route GET /api/worksheets/class-date
 */
export const getClassWorksheetsForDate = async (
  req: Request,
  res: Response,
) => {
  const { classId, submittedOn } = req.query;

  if (!classId || !submittedOn) {
    return res.status(400).json({
      message: "Missing required query parameters: classId and submittedOn",
    });
  }

  try {
    const dateStr = submittedOn as string;
    const date = new Date(dateStr);
    const startDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    const endDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1),
    );

    // 1. Get all students in the class
    const studentClasses = await prisma.studentClass.findMany({
      where: {
        classId: classId as string,
        student: {
          isArchived: false,
        },
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            tokenNumber: true,
          },
        },
      },
    });

    const students = studentClasses.map((sc) => sc.student);
    const studentIds = students.map((s) => s.id);

    // 2. Fetch all worksheets for this class on this date (single query)
    const worksheetsOnDate = await prisma.worksheet.findMany({
      where: {
        classId: classId as string,
        studentId: { in: studentIds },
        submittedOn: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: {
        template: {
          select: {
            id: true,
            worksheetNumber: true,
          },
        },
        images: {
          orderBy: {
            pageNumber: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Group worksheets by studentId
    const worksheetsByStudent: Record<string, typeof worksheetsOnDate> = {};
    for (const ws of worksheetsOnDate) {
      if (ws.studentId) {
        if (!worksheetsByStudent[ws.studentId]) {
          worksheetsByStudent[ws.studentId] = [];
        }
        worksheetsByStudent[ws.studentId].push(ws);
      }
    }

    // Calculate stats for the response
    const studentsWithWorksheets = new Set<string>();
    let gradedCount = 0;
    let absentCount = 0;
    let pendingCount = 0;

    for (const ws of worksheetsOnDate) {
      if (ws.studentId) {
        studentsWithWorksheets.add(ws.studentId);
      }
      if (ws.isAbsent) {
        absentCount++;
      } else if (
        ws.grade !== null &&
        ws.status === ProcessingStatus.COMPLETED
      ) {
        gradedCount++;
      } else if (
        ws.status === ProcessingStatus.PENDING ||
        ws.status === ProcessingStatus.PROCESSING
      ) {
        pendingCount++;
      }
    }

    const stats = {
      totalStudents: students.length,
      studentsWithWorksheets: studentsWithWorksheets.size,
      gradedCount,
      absentCount,
      pendingCount,
    };

    // 3. For students without worksheets on this date, get lightweight summary for recommendations
    const studentsWithoutWorksheets = studentIds.filter(
      (id) => !worksheetsByStudent[id],
    );

    let studentSummaries: Record<
      string,
      {
        lastWorksheetNumber: number | null;
        lastGrade: number | null;
        completedWorksheetNumbers: number[];
        recommendedWorksheetNumber: number;
        isRecommendedRepeated: boolean;
      }
    > = {};

    if (studentsWithoutWorksheets.length > 0) {
      const endDateForHistory = new Date(dateStr);
      endDateForHistory.setHours(23, 59, 59, 999);
      const progressionThreshold = parseInt(
        process.env.PROGRESSION_THRESHOLD || "32",
      );

      // Fetch only the minimal data needed for recommendations
      const historyData = await prisma.worksheet.findMany({
        where: {
          classId: classId as string,
          studentId: { in: studentsWithoutWorksheets },
          submittedOn: {
            lt: endDateForHistory,
          },
          status: ProcessingStatus.COMPLETED,
          isAbsent: false,
          grade: { not: null },
        },
        select: {
          studentId: true,
          grade: true,
          submittedOn: true,
          createdAt: true,
          worksheetNumber: true,
          template: {
            select: {
              worksheetNumber: true,
            },
          },
        },
        orderBy: [
          { submittedOn: "desc" },
          { createdAt: "desc" },
          { worksheetNumber: "desc" },
        ],
      });

      // Find students with no history in this class — they may have
      // history in a prior class (e.g., after academic year onboarding)
      const studentIdsWithHistory = new Set(historyData.map(h => h.studentId));
      const newStudentIds = studentsWithoutWorksheets.filter(id => !studentIdsWithHistory.has(id));

      // For new-to-class students, fetch their most recent worksheet
      // from ANY class to continue date-based progression
      let priorClassHistory = new Map<string, { worksheetNumber: number; grade: number | null; submittedOn: Date | null; createdAt: Date }>();
      if (newStudentIds.length > 0) {
        const results = await Promise.all(
          newStudentIds.map(sid =>
            prisma.worksheet.findFirst({
              where: {
                studentId: sid,
                submittedOn: { lt: endDateForHistory },
                status: ProcessingStatus.COMPLETED,
                isAbsent: false,
                grade: { not: null },
              },
              select: {
                studentId: true,
                worksheetNumber: true,
                grade: true,
                submittedOn: true,
                createdAt: true,
                template: { select: { worksheetNumber: true } },
              },
              orderBy: [
                { submittedOn: "desc" },
                { createdAt: "desc" },
                { worksheetNumber: "desc" },
              ],
            })
          )
        );
        for (const latest of results) {
          if (latest) {
            const wsNum = getEffectiveWorksheetNumber(latest.worksheetNumber, latest.template?.worksheetNumber ?? null);
            if (wsNum && wsNum > 0) {
              priorClassHistory.set(latest.studentId!, {
                worksheetNumber: wsNum,
                grade: latest.grade,
                submittedOn: latest.submittedOn,
                createdAt: latest.createdAt,
              });
            }
          }
        }
      }

      for (const studentId of studentsWithoutWorksheets) {
        const studentHistory = historyData
          .filter((h) => h.studentId === studentId)
          .map((h) => ({
            grade: h.grade,
            submittedOn: h.submittedOn,
            createdAt: h.createdAt,
            effectiveWorksheetNumber: getEffectiveWorksheetNumber(
              h.worksheetNumber,
              h.template?.worksheetNumber ?? null,
            ),
          }));

        // If no history in current class, use prior class history
        const prior = priorClassHistory.get(studentId);
        const historyForRecommendation = studentHistory.length > 0
          ? studentHistory
          : prior
            ? [{ grade: prior.grade, submittedOn: prior.submittedOn, createdAt: prior.createdAt, effectiveWorksheetNumber: prior.worksheetNumber }]
            : [];

        const recommendation = buildWorksheetRecommendationFromHistory(
          historyForRecommendation,
          progressionThreshold,
        );

        studentSummaries[studentId] = {
          lastWorksheetNumber: recommendation.lastWorksheetNumber,
          lastGrade: recommendation.lastGrade,
          completedWorksheetNumbers: recommendation.completedWorksheetNumbers,
          recommendedWorksheetNumber: recommendation.recommendedWorksheetNumber,
          isRecommendedRepeated: recommendation.isRecommendedRepeated,
        };
      }
    }

    return res.status(200).json({
      students,
      worksheetsByStudent,
      studentSummaries,
      stats,
    });
  } catch (error) {
    console.error("Get class worksheets for date error:", error);
    return res
      .status(500)
      .json({ message: "Server error while retrieving class worksheets" });
  }
};

export const getIncorrectGradingWorksheets = async (
  req: Request,
  res: Response,
) => {
  try {
    const {
      page = "1",
      pageSize = "10",
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      pageSize?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageNum = Math.max(parseInt(page || "1", 10) || 1, 1);
    const sizeNum = Math.min(
      Math.max(parseInt(pageSize || "10", 10) || 10, 1),
      100,
    );

    const where: any = {
      isIncorrectGrade: true,
      status: ProcessingStatus.COMPLETED,
    };

    const startBoundary = startDate
      ? parseDateInputToUtcStart(String(startDate))
      : null;
    const endBoundary = endDate
      ? parseDateInputToUtcEndExclusive(String(endDate))
      : null;

    if ((startDate && !startBoundary) || (endDate && !endBoundary)) {
      return res
        .status(400)
        .json({ message: "Invalid startDate/endDate values" });
    }
    if (startBoundary && endBoundary && startBoundary >= endBoundary) {
      return res
        .status(400)
        .json({ message: "startDate must be before or equal to endDate" });
    }

    if (startBoundary || endBoundary) {
      const dateRange: { gte?: Date; lt?: Date } = {};
      if (startBoundary) {
        dateRange.gte = startBoundary;
      }
      if (endBoundary) {
        dateRange.lt = endBoundary;
      }

      where.AND = [
        {
          OR: [{ submittedOn: dateRange }, { createdAt: dateRange }],
        },
      ];
    }

    const worksheets = await prisma.worksheet.findMany({
      where,
      include: {
        student: { select: { id: true, name: true, tokenNumber: true } },
        submittedBy: { select: { name: true, username: true } },
        class: { select: { name: true } },
        template: { select: { worksheetNumber: true } },
        images: {
          select: { imageUrl: true, pageNumber: true },
          orderBy: { pageNumber: "asc" },
        },
      },
      orderBy: [{ submittedOn: "desc" }, { worksheetNumber: "asc" }],
    });

    const worksheetIds = worksheets.map((worksheet) => worksheet.id);
    const gradingJobsWithImages =
      worksheetIds.length > 0
        ? await prisma.gradingJob.findMany({
            where: {
              worksheetId: { in: worksheetIds },
              status: GradingJobStatus.COMPLETED,
            },
            select: {
              worksheetId: true,
              worksheetNumber: true,
              updatedAt: true,
              images: {
                select: { imageUrl: true, pageNumber: true },
                orderBy: { pageNumber: "asc" },
              },
            },
          })
        : [];

    const jobContextByWorksheet = new Map<
      string,
      {
        updatedAtMs: number;
        images: Array<{ imageUrl: string; pageNumber: number }>;
        worksheetNumber: number | null;
      }
    >();
    for (const gradingJob of gradingJobsWithImages) {
      if (!gradingJob.worksheetId || gradingJob.images.length === 0) {
        continue;
      }

      const updatedAtMs = gradingJob.updatedAt.getTime();
      const gradingJobWorksheetNumber = getFirstPositiveNumber(
        gradingJob.worksheetNumber,
      );
      const existing = jobContextByWorksheet.get(gradingJob.worksheetId);
      if (!existing) {
        jobContextByWorksheet.set(gradingJob.worksheetId, {
          updatedAtMs,
          images: gradingJob.images,
          worksheetNumber: gradingJobWorksheetNumber,
        });
        continue;
      }

      const shouldReplace =
        gradingJob.images.length > existing.images.length ||
        (gradingJob.images.length === existing.images.length &&
          updatedAtMs > existing.updatedAtMs) ||
        (existing.worksheetNumber === null &&
          gradingJobWorksheetNumber !== null);

      if (shouldReplace) {
        jobContextByWorksheet.set(gradingJob.worksheetId, {
          updatedAtMs,
          images: gradingJob.images,
          worksheetNumber: gradingJobWorksheetNumber,
        });
      }
    }

    const unresolvedWorksheets = worksheets.filter((worksheet) => {
      if (worksheet.images.length > 0) {
        return false;
      }
      const imagesFromLinkedJob =
        jobContextByWorksheet.get(worksheet.id)?.images || [];
      return imagesFromLinkedJob.length === 0;
    });

    if (unresolvedWorksheets.length > 0) {
      const unresolvedStudentIds = Array.from(
        new Set(
          unresolvedWorksheets
            .map((worksheet) => worksheet.studentId)
            .filter((studentId): studentId is string => !!studentId),
        ),
      );
      const unresolvedClassIds = Array.from(
        new Set(unresolvedWorksheets.map((worksheet) => worksheet.classId)),
      );
      const unresolvedWorksheetNumbers = Array.from(
        new Set(
          unresolvedWorksheets
            .map((worksheet) =>
              getFirstPositiveNumber(
                worksheet.worksheetNumber,
                worksheet.template?.worksheetNumber ?? null,
                jobContextByWorksheet.get(worksheet.id)?.worksheetNumber ??
                  null,
                parseWorksheetNumberFromNotes(worksheet.notes),
              ),
            )
            .filter(
              (worksheetNumber): worksheetNumber is number =>
                worksheetNumber !== null,
            ),
        ),
      );

      if (
        unresolvedStudentIds.length > 0 &&
        unresolvedClassIds.length > 0 &&
        unresolvedWorksheetNumbers.length > 0
      ) {
        const fallbackJobs = await prisma.gradingJob.findMany({
          where: {
            status: GradingJobStatus.COMPLETED,
            studentId: { in: unresolvedStudentIds },
            classId: { in: unresolvedClassIds },
            worksheetNumber: { in: unresolvedWorksheetNumbers },
          },
          select: {
            studentId: true,
            classId: true,
            worksheetNumber: true,
            submittedOn: true,
            updatedAt: true,
            images: {
              select: { imageUrl: true, pageNumber: true },
              orderBy: { pageNumber: "asc" },
            },
          },
        });

        const getUtcDayBounds = (
          date: Date,
        ): { start: Date; endExclusive: Date } => {
          const start = new Date(
            Date.UTC(
              date.getUTCFullYear(),
              date.getUTCMonth(),
              date.getUTCDate(),
            ),
          );
          const endExclusive = new Date(start);
          endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
          return { start, endExclusive };
        };

        for (const worksheet of unresolvedWorksheets) {
          const worksheetNumberForMatching = getFirstPositiveNumber(
            worksheet.worksheetNumber,
            worksheet.template?.worksheetNumber ?? null,
            jobContextByWorksheet.get(worksheet.id)?.worksheetNumber ?? null,
            parseWorksheetNumberFromNotes(worksheet.notes),
          );

          if (!worksheet.studentId || !worksheetNumberForMatching) {
            continue;
          }

          const worksheetDateBase =
            worksheet.submittedOn || worksheet.createdAt;
          const { start, endExclusive } = getUtcDayBounds(worksheetDateBase);

          const candidates = fallbackJobs.filter(
            (job) =>
              job.studentId === worksheet.studentId &&
              job.classId === worksheet.classId &&
              job.worksheetNumber === worksheetNumberForMatching &&
              job.submittedOn >= start &&
              job.submittedOn < endExclusive &&
              job.images.length > 0,
          );

          if (candidates.length === 0) {
            continue;
          }

          candidates.sort((a, b) => {
            if (b.images.length !== a.images.length) {
              return b.images.length - a.images.length;
            }
            return b.updatedAt.getTime() - a.updatedAt.getTime();
          });

          const best = candidates[0];
          jobContextByWorksheet.set(worksheet.id, {
            updatedAtMs: best.updatedAt.getTime(),
            images: best.images,
            worksheetNumber: getFirstPositiveNumber(best.worksheetNumber),
          });
        }
      }
    }

    const transformed = worksheets.map((worksheet) => {
      const linkedJobContext = jobContextByWorksheet.get(worksheet.id);
      const effectiveWorksheetNumber =
        getFirstPositiveNumber(
          worksheet.worksheetNumber,
          worksheet.template?.worksheetNumber ?? null,
          linkedJobContext?.worksheetNumber ?? null,
          parseWorksheetNumberFromNotes(worksheet.notes),
        ) || 0;

      return {
        id: worksheet.id,
        worksheetNumber: effectiveWorksheetNumber,
        grade: worksheet.grade || 0,
        submittedOn: worksheet.submittedOn,
        updatedAt: worksheet.updatedAt,
        adminComments: worksheet.adminComments,
        wrongQuestionNumbers: worksheet.wrongQuestionNumbers,
        student: {
          id: worksheet.student?.id || null,
          name: worksheet.student?.name || "Unknown",
          tokenNumber: worksheet.student?.tokenNumber || "N/A",
        },
        submittedBy: {
          name: worksheet.submittedBy.name,
          username: worksheet.submittedBy.username,
        },
        class: { name: worksheet.class.name },
        gradingDetails: worksheet.gradingDetails,
        images:
          worksheet.images.length > 0
            ? worksheet.images
            : linkedJobContext?.images || [],
      };
    });

    const scoreWorksheet = (
      worksheet: (typeof transformed)[number],
    ): number => {
      let score = 0;
      if (worksheet.gradingDetails) score += 4;
      if (worksheet.images.length > 0) score += 2;
      if (worksheet.wrongQuestionNumbers) score += 1;
      return score;
    };

    const dedupedByKey = new Map<string, (typeof transformed)[number]>();
    for (const w of transformed) {
      const dt = w.submittedOn ? new Date(w.submittedOn as any) : new Date(0);
      const dateKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
      const studentKey = w.student?.id || "unknown";
      const key = `${studentKey}|${w.worksheetNumber}|${dateKey}`;

      const current = dedupedByKey.get(key);
      if (!current) {
        dedupedByKey.set(key, w);
        continue;
      }

      const currentScore = scoreWorksheet(current);
      const nextScore = scoreWorksheet(w);
      if (nextScore > currentScore) {
        dedupedByKey.set(key, w);
        continue;
      }

      if (nextScore === currentScore) {
        const currentUpdatedAt = current.updatedAt
          ? new Date(current.updatedAt).getTime()
          : 0;
        const nextUpdatedAt = w.updatedAt ? new Date(w.updatedAt).getTime() : 0;
        if (nextUpdatedAt > currentUpdatedAt) {
          dedupedByKey.set(key, w);
        }
      }
    }

    const submittedOnTime = (value: unknown): number => {
      if (!value) return 0;
      const timestamp = new Date(value as any).getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    };

    const deduped = Array.from(dedupedByKey.values()).sort((a, b) => {
      const dateDiff =
        submittedOnTime(b.submittedOn) - submittedOnTime(a.submittedOn);
      if (dateDiff !== 0) return dateDiff;
      return a.worksheetNumber - b.worksheetNumber;
    });

    const total = deduped.length;
    const startIdx = (pageNum - 1) * sizeNum;
    const endIdx = startIdx + sizeNum;
    const data = deduped.slice(startIdx, endIdx).map((w) => ({
      id: w.id,
      worksheetNumber: w.worksheetNumber,
      grade: w.grade,
      submittedOn: w.submittedOn,
      adminComments: w.adminComments,
      wrongQuestionNumbers: w.wrongQuestionNumbers,
      student: { name: w.student.name, tokenNumber: w.student.tokenNumber },
      submittedBy: {
        name: w.submittedBy.name,
        username: w.submittedBy.username,
      },
      class: { name: w.class.name },
      gradingDetails: w.gradingDetails,
      images: w.images,
    }));

    return res
      .status(200)
      .json({ data, total, page: pageNum, pageSize: sizeNum });
  } catch (error) {
    console.error("Get incorrect grading worksheets error:", error);
    return res.status(500).json({
      message: "Server error while retrieving incorrect grading worksheets",
    });
  }
};

export const updateWorksheetAdminComments = async (
  req: Request,
  res: Response,
) => {
  const { id } = req.params;
  const { adminComments } = req.body;

  try {
    const existingWorksheet = await prisma.worksheet.findUnique({
      where: { id },
    });

    if (!existingWorksheet) {
      return res.status(404).json({ message: "Worksheet not found" });
    }

    const updatedWorksheet = await prisma.worksheet.update({
      where: { id },
      data: {
        adminComments: adminComments || null,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({
      message: "Admin comments updated successfully",
      worksheet: updatedWorksheet,
    });
  } catch (error) {
    console.error("Update worksheet admin comments error:", error);
    return res
      .status(500)
      .json({ message: "Server error while updating admin comments" });
  }
};

export const markWorksheetAsCorrectlyGraded = async (
  req: Request,
  res: Response,
) => {
  const { id } = req.params;

  try {
    // Find the existing worksheet
    const existingWorksheet = await prisma.worksheet.findUnique({
      where: { id },
    });

    if (!existingWorksheet) {
      return res.status(404).json({ message: "Worksheet not found" });
    }

    // Update the worksheet to mark it as correctly graded
    const updatedWorksheet = await prisma.worksheet.update({
      where: { id },
      data: {
        isIncorrectGrade: false,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({
      message: "Worksheet marked as correctly graded",
      worksheet: updatedWorksheet,
    });
  } catch (error) {
    console.error("Mark worksheet as correctly graded error:", error);
    return res.status(500).json({
      message: "Server error while updating worksheet grading status",
    });
  }
};

/**
 * Get worksheet images from Python API
 * @route GET /api/worksheets/images
 */
export const getWorksheetImages = async (req: Request, res: Response) => {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { token_no, worksheet_name } = req.body;
  const pythonApiUrl = process.env.PYTHON_API_URL;

  if (!pythonApiUrl) {
    console.error("PYTHON_API_URL environment variable not set");
    return res.status(500).json({
      message: "Server configuration error: PYTHON_API_URL not set",
    });
  }

  try {
    // Call Python API to get worksheet images
    const response = await fetch(`${pythonApiUrl}/get-worksheet-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token_no: token_no as string,
        worksheet_name: worksheet_name as string,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({
        message: error.message || "Failed to fetch images from Python API",
      });
    }

    const imageUrls = await response.json();
    return res.status(200).json(imageUrls);
  } catch (error) {
    console.error("Get worksheet images error:", error);
    return res
      .status(500)
      .json({ message: "Server error while fetching worksheet images" });
  }
};

/**
 * Get total AI graded worksheets count from database
 */
export const getTotalAiGraded = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.body;
    const startBoundary = startDate
      ? parseDateInputToUtcStart(String(startDate))
      : null;
    const endBoundaryExclusive = endDate
      ? parseDateInputToUtcEndExclusive(String(endDate))
      : null;

    if ((startDate && !startBoundary) || (endDate && !endBoundaryExclusive)) {
      return res
        .status(400)
        .json({ message: "Invalid startDate/endDate values" });
    }
    if (
      startBoundary &&
      endBoundaryExclusive &&
      startBoundary >= endBoundaryExclusive
    ) {
      return res
        .status(400)
        .json({ message: "startDate must be before or equal to endDate" });
    }

    const where: Prisma.GradingJobWhereInput = {
      status: GradingJobStatus.COMPLETED,
    };

    if (startBoundary || endBoundaryExclusive) {
      const dateRange: { gte?: Date; lt?: Date } = {};
      if (startBoundary) {
        dateRange.gte = startBoundary;
      }
      if (endBoundaryExclusive) {
        dateRange.lt = endBoundaryExclusive;
      }

      where.AND = [
        {
          OR: [{ submittedOn: dateRange }, { createdAt: dateRange }],
        },
      ];
    }

    const totalAiGraded = await prisma.gradingJob.count({
      where,
    });

    return res.status(200).json({ total_ai_graded: totalAiGraded });
  } catch (error) {
    console.error("Get total AI graded error:", error);
    return res.status(500).json({
      message:
        "Server error while fetching total AI graded count from database",
    });
  }
};

/**
 * Get student grading details from Python API
 * @route POST /api/worksheets/student-grading-details
 */
export const getStudentGradingDetails = async (req: Request, res: Response) => {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { token_no, worksheet_name, overall_score } = req.body;
  const pythonApiUrl = process.env.PYTHON_API_URL;

  if (!pythonApiUrl) {
    console.error("PYTHON_API_URL environment variable not set");
    return res.status(500).json({
      message: "Server configuration error: PYTHON_API_URL not set",
    });
  }

  try {
    // Prepare request body for Python API
    const requestBody: any = {
      token_no: token_no as string,
      worksheet_name: worksheet_name as string,
    };

    // Only include overall_score if it's provided
    if (overall_score !== undefined && overall_score !== null) {
      requestBody.overall_score = overall_score as number;
    }

    // Call Python API to get student grading details
    const response = await fetch(`${pythonApiUrl}/student-grading-details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({
        message:
          error.message || "Failed to fetch grading details from Python API",
      });
    }

    const gradingDetails = await response.json();
    return res.status(200).json(gradingDetails);
  } catch (error) {
    console.error("Get student grading details error:", error);
    return res
      .status(500)
      .json({ message: "Server error while fetching student grading details" });
  }
};

// ============================================================================
// NEW ENDPOINTS FOR FRONTEND OPTIMIZATION
// ============================================================================

/**
 * Check if a worksheet would be a repeat for a student
 * Moves the "is repeated" logic from frontend to backend
 * @route POST /api/worksheets/check-repeated
 */
export const checkIsRepeated = async (req: Request, res: Response) => {
  const { classId, studentId, worksheetNumber, beforeDate } = req.body;

  if (!classId || !studentId || !worksheetNumber) {
    return res.status(400).json({
      message: "Missing required fields: classId, studentId, worksheetNumber",
    });
  }

  try {
    const worksheetNum = parseInt(worksheetNumber);
    if (isNaN(worksheetNum) || worksheetNum <= 0) {
      return res.status(400).json({ message: "Invalid worksheet number" });
    }

    // Find the template for this worksheet number
    const template = await prisma.worksheetTemplate.findFirst({
      where: { worksheetNumber: worksheetNum },
    });

    if (!template) {
      return res.status(200).json({
        isRepeated: false,
        reason: "Template not found for this worksheet number",
      });
    }

    // Build date filter
    const dateFilter: any = {};
    if (beforeDate) {
      const beforeDateObj = new Date(beforeDate);
      beforeDateObj.setUTCHours(23, 59, 59, 999);
      dateFilter.lt = beforeDateObj;
    }

    // Check if student has completed this worksheet before in the CURRENT class
    // (cross-class completions don't count as repeats in the new class)
    const existingWorksheet = await prisma.worksheet.findFirst({
      where: {
        classId,
        studentId,
        templateId: template.id,
        status: ProcessingStatus.COMPLETED,
        isAbsent: false,
        grade: { not: null },
        ...(beforeDate ? { submittedOn: dateFilter } : {}),
      },
      select: {
        id: true,
        grade: true,
        submittedOn: true,
      },
      orderBy: {
        submittedOn: "desc",
      },
    });

    const isRepeated = !!existingWorksheet;

    return res.status(200).json({
      isRepeated,
      previousWorksheet: existingWorksheet
        ? {
            id: existingWorksheet.id,
            grade: existingWorksheet.grade,
            submittedOn: existingWorksheet.submittedOn,
          }
        : null,
    });
  } catch (error) {
    console.error("Check is repeated error:", error);
    return res
      .status(500)
      .json({ message: "Server error while checking repeated status" });
  }
};

/**
 * Get recommended next worksheet for a student
 * Moves progression threshold logic from frontend to backend
 * @route POST /api/worksheets/recommend-next
 */
export const getRecommendedWorksheet = async (req: Request, res: Response) => {
  const { classId, studentId, beforeDate } = req.body;
  const PROGRESSION_THRESHOLD = parseInt(
    process.env.PROGRESSION_THRESHOLD || "32",
  );

  if (!classId || !studentId) {
    return res
      .status(400)
      .json({ message: "Missing required fields: classId, studentId" });
  }

  try {
    // Build date filter
    const dateFilter: any = {};
    if (beforeDate) {
      const beforeDateObj = new Date(beforeDate);
      beforeDateObj.setUTCHours(23, 59, 59, 999);
      dateFilter.lt = beforeDateObj;
    }

    // Get student's worksheet history and resolve worksheet number from direct field
    // with a template fallback for legacy rows.
    const worksheetHistory = await prisma.worksheet.findMany({
      where: {
        classId,
        studentId,
        status: ProcessingStatus.COMPLETED,
        isAbsent: false,
        grade: { not: null },
        ...(beforeDate ? { submittedOn: dateFilter } : {}),
      },
      select: {
        grade: true,
        worksheetNumber: true,
        submittedOn: true,
        createdAt: true,
        template: {
          select: {
            worksheetNumber: true,
          },
        },
      },
      orderBy: [
        { submittedOn: "desc" },
        { createdAt: "desc" },
        { worksheetNumber: "desc" },
      ],
    });

    const recommendation = buildWorksheetRecommendationFromHistory(
      worksheetHistory.map((worksheet) => ({
        grade: worksheet.grade,
        submittedOn: worksheet.submittedOn,
        createdAt: worksheet.createdAt,
        effectiveWorksheetNumber: getEffectiveWorksheetNumber(
          worksheet.worksheetNumber,
          worksheet.template?.worksheetNumber ?? null,
        ),
      })),
      PROGRESSION_THRESHOLD,
    );

    if (recommendation.lastWorksheetNumber === null) {
      // No history in current class — check for prior class history
      // to continue date-based progression after academic year onboarding
      const latestPrior = await prisma.worksheet.findFirst({
        where: {
          studentId,
          status: ProcessingStatus.COMPLETED,
          isAbsent: false,
          grade: { not: null },
          ...(beforeDate ? { submittedOn: dateFilter } : {}),
        },
        select: {
          worksheetNumber: true,
          grade: true,
          submittedOn: true,
          createdAt: true,
          template: { select: { worksheetNumber: true } },
        },
        orderBy: [
          { submittedOn: "desc" },
          { createdAt: "desc" },
          { worksheetNumber: "desc" },
        ],
      });

      if (latestPrior) {
        const priorWsNum = getEffectiveWorksheetNumber(
          latestPrior.worksheetNumber,
          latestPrior.template?.worksheetNumber ?? null,
        );
        if (priorWsNum && priorWsNum > 0) {
          const priorRecommendation = buildWorksheetRecommendationFromHistory(
            [{ grade: latestPrior.grade, submittedOn: latestPrior.submittedOn, createdAt: latestPrior.createdAt, effectiveWorksheetNumber: priorWsNum }],
            PROGRESSION_THRESHOLD,
          );
          return res.status(200).json({
            recommendedWorksheetNumber: priorRecommendation.recommendedWorksheetNumber,
            isRepeated: false,
            lastWorksheetNumber: priorRecommendation.lastWorksheetNumber,
            lastGrade: priorRecommendation.lastGrade,
            progressionThreshold: PROGRESSION_THRESHOLD,
          });
        }
      }

      // Truly no history anywhere — start from 1
      return res.status(200).json({
        recommendedWorksheetNumber: 1,
        isRepeated: false,
        lastWorksheetNumber: null,
        lastGrade: null,
        progressionThreshold: PROGRESSION_THRESHOLD,
      });
    }

    return res.status(200).json({
      recommendedWorksheetNumber: recommendation.recommendedWorksheetNumber,
      isRepeated: recommendation.isRecommendedRepeated,
      lastWorksheetNumber: recommendation.lastWorksheetNumber,
      lastGrade: recommendation.lastGrade,
      progressionThreshold: PROGRESSION_THRESHOLD,
    });
  } catch (error) {
    console.error("Get recommended worksheet error:", error);
    return res
      .status(500)
      .json({ message: "Server error while getting recommendation" });
  }
};

/**
 * Batch save worksheets for multiple students
 * Reduces N API calls to 1
 * @route POST /api/worksheets/batch-save
 */
export const batchSaveWorksheets = async (req: Request, res: Response) => {
  const { classId, submittedOn, worksheets } = req.body;
  const submittedById = req.user?.userId;

  if (!classId || !submittedOn || !worksheets || !Array.isArray(worksheets)) {
    return res.status(400).json({
      message:
        "Missing required fields: classId, submittedOn, worksheets array",
    });
  }

  if (!submittedById) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Normalize submittedOn to midnight UTC
  const submittedOnDate = new Date(submittedOn);
  submittedOnDate.setUTCHours(0, 0, 0, 0);

  const results: {
    saved: number;
    updated: number;
    deleted: number;
    failed: number;
    errors: { studentId: string; error: string }[];
  } = {
    saved: 0,
    updated: 0,
    deleted: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Process each worksheet in a transaction
    for (const ws of worksheets) {
      const {
        studentId,
        worksheetNumber,
        grade,
        isAbsent,
        isRepeated,
        isIncorrectGrade,
        gradingDetails,
        wrongQuestionNumbers,
        action,
      } = ws;

      if (!studentId) {
        results.failed++;
        results.errors.push({
          studentId: "unknown",
          error: "Missing studentId",
        });
        continue;
      }

      try {
        // Handle delete action
        if (action === "delete") {
          const deleted = await prisma.worksheet.deleteMany({
            where: {
              classId,
              studentId,
              submittedOn: submittedOnDate,
            },
          });
          if (deleted.count > 0) {
            results.deleted += deleted.count;
          }
          continue;
        }

        // Handle absent students
        if (isAbsent) {
          await prisma.worksheet.upsert({
            where: {
              unique_worksheet_per_student_day: {
                studentId,
                classId,
                worksheetNumber: 0,
                submittedOn: submittedOnDate,
              },
            },
            update: {
              grade: 0,
              isAbsent: true,
              status: ProcessingStatus.COMPLETED,
              worksheetNumber: 0,
            },
            create: {
              classId,
              studentId,
              submittedById,
              worksheetNumber: 0,
              grade: 0,
              isAbsent: true,
              isRepeated: false,
              status: ProcessingStatus.COMPLETED,
              outOf: 40,
              submittedOn: submittedOnDate,
            },
          });
          results.saved++;
          continue;
        }

        // Handle graded worksheets
        if (!worksheetNumber || worksheetNumber <= 0) {
          results.failed++;
          results.errors.push({ studentId, error: "Invalid worksheet number" });
          continue;
        }

        const gradeValue = parseFloat(grade);
        if (isNaN(gradeValue) || gradeValue < 0 || gradeValue > 40) {
          results.failed++;
          results.errors.push({
            studentId,
            error: "Invalid grade (must be 0-40)",
          });
          continue;
        }

        // Find template (optional - may not exist for all worksheet numbers)
        const worksheetNum = parseInt(worksheetNumber);
        const template = await prisma.worksheetTemplate.findFirst({
          where: { worksheetNumber: worksheetNum },
        });

        // Check if worksheet exists
        const existing = await prisma.worksheet.findFirst({
          where: {
            studentId,
            classId,
            worksheetNumber: worksheetNum,
            submittedOn: submittedOnDate,
          },
        });

        await prisma.worksheet.upsert({
          where: {
            unique_worksheet_per_student_day: {
              studentId,
              classId,
              worksheetNumber: worksheetNum,
              submittedOn: submittedOnDate,
            },
          },
          update: {
            grade: gradeValue,
            status: ProcessingStatus.COMPLETED,
            isRepeated: isRepeated || false,
            isIncorrectGrade: isIncorrectGrade || false,
            gradingDetails: gradingDetails || undefined,
            wrongQuestionNumbers: wrongQuestionNumbers || undefined,
            worksheetNumber: worksheetNum,
          },
          create: {
            classId,
            studentId,
            submittedById,
            templateId: template?.id,
            worksheetNumber: worksheetNum,
            grade: gradeValue,
            status: ProcessingStatus.COMPLETED,
            outOf: 40,
            submittedOn: submittedOnDate,
            isAbsent: false,
            isRepeated: isRepeated || false,
            isIncorrectGrade: isIncorrectGrade || false,
            gradingDetails: gradingDetails || undefined,
            wrongQuestionNumbers: wrongQuestionNumbers || undefined,
          },
        });

        if (existing) {
          results.updated++;
        } else {
          results.saved++;
        }
      } catch (wsError: any) {
        results.failed++;
        results.errors.push({
          studentId,
          error: wsError.message || "Unknown error",
        });
      }
    }

    return res.status(200).json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error("Batch save worksheets error:", error);
    return res
      .status(500)
      .json({ message: "Server error while saving worksheets" });
  }
};
