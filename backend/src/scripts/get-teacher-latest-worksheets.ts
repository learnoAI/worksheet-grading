import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
});

async function getLatestWorksheetsByTeacher() {
    try {
        console.log('Connecting to database...\n');

        // Get all teachers
        const teachers = await prisma.user.findMany({
            where: {
                role: 'TEACHER',
                isArchived: false
            },
            select: {
                id: true,
                name: true,
                username: true
            },
            orderBy: {
                name: 'asc'
            }
        });

        console.log(`Found ${teachers.length} teachers\n`);
        console.log('='.repeat(100));
        console.log(`${'Teacher Name'.padEnd(30)} | ${'Username'.padEnd(20)} | ${'Latest SubmittedOn'.padEnd(20)} | ${'Class'}`);
        console.log('='.repeat(100));

        for (const teacher of teachers) {
            // Find the most recent worksheet submitted by this teacher
            const latestWorksheet = await prisma.worksheet.findFirst({
                where: {
                    submittedById: teacher.id
                },
                orderBy: {
                    submittedOn: 'desc'
                },
                select: {
                    submittedOn: true,
                    class: {
                        select: {
                            name: true,
                            school: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    }
                }
            });

            const submittedOnStr = latestWorksheet?.submittedOn
                ? latestWorksheet.submittedOn.toISOString().split('T')[0]
                : 'No worksheets';

            const classInfo = latestWorksheet?.class
                ? `${latestWorksheet.class.school.name} - ${latestWorksheet.class.name}`
                : '-';

            console.log(
                `${teacher.name.padEnd(30)} | ${teacher.username.padEnd(20)} | ${submittedOnStr.padEnd(20)} | ${classInfo}`
            );
        }

        console.log('='.repeat(100));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

getLatestWorksheetsByTeacher();
