import { PrismaClient, UserRole } from '@prisma/client';
import * as XLSX from 'xlsx';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();

interface StudentData {
    Token_no: string;
    Student_name: string;
    School_Name: string;
    Class: string;
}

async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}

async function createOrGetStudent(name: string, tokenNumber: string, index: number) {
    const username = name.toLowerCase().replace(/\s+/g, '_') + '_' + index;

    const existingStudent = await prisma.user.findFirst({
        where: {
            OR: [
                { tokenNumber },
                { username }
            ]
        }
    });

    if (existingStudent) {
        return existingStudent;
    }
    const hashedPassword = await hashPassword('saarthi@123');
    return await prisma.user.create({
        data: {
            username,
            tokenNumber,
            password: hashedPassword,
            role: UserRole.STUDENT
        }
    });
}

async function getSchool(name: string) {
    const school = await prisma.school.findFirst({
        where: { name }
    });

    if (!school) {
        throw new Error(`School not found: ${name}`);
    }

    return school;
}

async function getClass(name: string, schoolId: string) {
    const classEntity = await prisma.class.findFirst({
        where: {
            name,
            schoolId
        }
    });

    if (!classEntity) {
        throw new Error(`Class not found: ${name} in school ${schoolId}`);
    }

    return classEntity;
}

function readExcelFile(filePath: string): StudentData[] {
    try {
        // Read the Excel file
        const workbook = XLSX.readFile(filePath);

        // Get the first worksheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Validate and transform the data
        const studentData: StudentData[] = jsonData.map((row: any) => {
            if (!row.Token_no || !row.Student_name || !row.School_Name || !row.Class) {
                throw new Error(`Invalid row data: ${JSON.stringify(row)}`);
            }

            return {
                Token_no: row.Token_no.toString().trim(),
                Student_name: row.Student_name.toString().trim(),
                School_Name: row.School_Name.toString().trim(),
                Class: row.Class.toString().trim()
            };
        });

        return studentData;
    } catch (error) {
        console.error('Error reading Excel file:', error);
        throw error;
    }
}

async function processStudentData(data: StudentData[]) {
    try {
        const batchSize = 15;
        console.log(`Processing ${data.length} student records in batches of ${batchSize}...`);

        // Process students in batches
        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);
            console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(data.length / batchSize)}`);

            await Promise.all(batch.map(async (row, index) => {
                try {
                    const batchIndex = i + index;
                    console.log(`\nStarting to process student: ${row.Student_name}`);

                    // Create or get student
                    const student = await createOrGetStudent(row.Student_name, row.Token_no, batchIndex);
                    console.log(`Student processed: ${student.username} (Token: ${student.tokenNumber})`);

                    // Get school
                    const school = await getSchool(row.School_Name);
                    console.log(`Found school: ${school.name} for student ${student.username}`);

                    // Get class
                    const classEntity = await getClass(row.Class, school.id);
                    console.log(`Found class: ${classEntity.name} for student ${student.username}`);

                    // Create student-school relationship if it doesn't exist
                    await prisma.studentSchool.upsert({
                        where: {
                            studentId_schoolId: {
                                studentId: student.id,
                                schoolId: school.id
                            }
                        },
                        create: {
                            studentId: student.id,
                            schoolId: school.id
                        },
                        update: {}
                    });
                    console.log(`Created/Updated student-school relationship for ${student.username}`);

                    // Create student-class relationship if it doesn't exist
                    await prisma.studentClass.upsert({
                        where: {
                            studentId_classId: {
                                studentId: student.id,
                                classId: classEntity.id
                            }
                        },
                        create: {
                            studentId: student.id,
                            classId: classEntity.id
                        },
                        update: {}
                    });
                    console.log(`Created/Updated student-class relationship for ${student.username}`);

                    console.log(`\nCompleted processing student: ${student.username}`);
                } catch (error) {
                    console.error(`Error processing student ${row.Student_name}:`, error);
                    throw error;
                }
            }));

            // Add a small delay between batches to allow connections to be released
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log('\nAll student data import completed successfully');
    } catch (error) {
        console.error('Error in batch processing of student data:', error);
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
const studentData = readExcelFile(excelFilePath);
processStudentData(studentData)
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    }); 