import { PrismaClient, UserRole } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();

interface TeacherData {
    SR_Name: string;
    School: string;
    Class: string;
}

async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}

async function createOrGetTeacher(name: string) {
    const username = name.toLowerCase().replace(/\s+/g, '_');

    const existingTeacher = await prisma.user.findUnique({
        where: { username }
    });

    if (existingTeacher) {
        return existingTeacher;
    }

    return await prisma.user.create({
        data: {
            name,
            username,
            password: await hashPassword('saarthi@123'),
            role: UserRole.TEACHER
        }
    });
}

async function createOrGetSchool(name: string) {
    const existingSchool = await prisma.school.findFirst({
        where: { name }
    });

    if (existingSchool) {
        return existingSchool;
    }

    return await prisma.school.create({
        data: { name }
    });
}

async function createOrGetClass(name: string, schoolId: string) {
    const existingClass = await prisma.class.findFirst({
        where: {
            name,
            schoolId
        }
    });

    if (existingClass) {
        return existingClass;
    }

    return await prisma.class.create({
        data: {
            name,
            schoolId
        }
    });
}

function readExcelFile(filePath: string): TeacherData[] {
    try {
        // Read the Excel file
        const workbook = XLSX.readFile(filePath);

        // Get the first worksheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Validate and transform the data
        const teacherData: TeacherData[] = jsonData.map((row: any) => {
            if (!row.SR_Name || !row.School || !row.Class) {
                throw new Error(`Invalid row data: ${JSON.stringify(row)}`);
            }

            return {
                SR_Name: row.SR_Name.toString().trim(),
                School: row.School.toString().trim(),
                Class: `${row.Class.toString().trim()} (25-26)`
            };
        });

        return teacherData;
    } catch (error) {
        console.error('Error reading Excel file:', error);
        throw error;
    }
}

async function processTeacherData(data: TeacherData[]) {
    try {
        console.log(`Processing ${data.length} records...`);

        for (const row of data) {
            console.log(`Processing teacher: ${row.SR_Name}`);

            // Create or get teacher
            const teacher = await createOrGetTeacher(row.SR_Name);
            console.log(`Teacher processed: ${teacher.username}`);

            // Create or get school
            const school = await createOrGetSchool(row.School);
            console.log(`School processed: ${school.name}`);

            // Create or get class
            const classEntity = await createOrGetClass(row.Class, school.id);
            console.log(`Class processed: ${classEntity.name}`);

            // Create teacher-school relationship if it doesn't exist
            await prisma.teacherSchool.upsert({
                where: {
                    teacherId_schoolId: {
                        teacherId: teacher.id,
                        schoolId: school.id
                    }
                },
                create: {
                    teacherId: teacher.id,
                    schoolId: school.id
                },
                update: {}
            });

            // Create teacher-class relationship if it doesn't exist
            await prisma.teacherClass.upsert({
                where: {
                    teacherId_classId: {
                        teacherId: teacher.id,
                        classId: classEntity.id
                    }
                },
                create: {
                    teacherId: teacher.id,
                    classId: classEntity.id
                },
                update: {}
            });

            console.log(`Completed processing for ${row.SR_Name}\n`);
        }

        console.log('Data import completed successfully');
    } catch (error) {
        console.error('Error processing teacher data:', error);
        throw error;
    }
}

// Get the Excel file path from command line arguments
const excelFilePath = process.argv[2];

if (!excelFilePath) {
    console.error('Please provide the Excel file path as a command line argument');
    process.exit(1);
}

// Read and process the Excel file
const teacherData = readExcelFile(excelFilePath);
processTeacherData(teacherData)
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    }); 