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

async function findMultipleWorksheetsPerDay() {
    try {
        console.log('Connecting to database...\n');
        console.log('Finding students with multiple worksheets on the same day...\n');

        // Find all cases where a student has multiple worksheets on the same day in the same class
        const worksheets = await prisma.worksheet.findMany({
            where: {
                studentId: { not: null },
                submittedOn: { not: null }
            },
            select: {
                id: true,
                studentId: true,
                classId: true,
                submittedOn: true,
                grade: true,
                isAbsent: true,
                worksheetNumber: true,
                student: {
                    select: {
                        name: true,
                        tokenNumber: true
                    }
                },
                submittedBy: {
                    select: {
                        id: true,
                        name: true,
                        username: true
                    }
                },
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
            },
            orderBy: [
                { submittedOn: 'desc' },
                { studentId: 'asc' }
            ]
        });

        // Group by student + class + date
        const grouped: Record<string, typeof worksheets> = {};

        for (const ws of worksheets) {
            if (!ws.studentId || !ws.submittedOn) continue;

            const dateStr = ws.submittedOn.toISOString().split('T')[0];
            const key = `${ws.studentId}|${ws.classId}|${dateStr}`;

            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(ws);
        }

        // Filter to only cases with multiple worksheets
        const multipleWorksheets = Object.entries(grouped)
            .filter(([_, wsList]) => wsList.length > 1)
            .sort((a, b) => {
                // Sort by date descending
                const dateA = a[1][0].submittedOn!;
                const dateB = b[1][0].submittedOn!;
                return dateB.getTime() - dateA.getTime();
            });

        if (multipleWorksheets.length === 0) {
            console.log('No students found with multiple worksheets on the same day.');
            return;
        }

        console.log(`Found ${multipleWorksheets.length} cases of multiple worksheets per student per day\n`);
        console.log('='.repeat(120));

        // Group by teacher for summary
        const byTeacher: Record<string, { teacherName: string; username: string; count: number; cases: any[] }> = {};

        for (const [key, wsList] of multipleWorksheets) {
            const firstWs = wsList[0];
            const teacherId = firstWs.submittedBy.id;
            const teacherName = firstWs.submittedBy.name;
            const username = firstWs.submittedBy.username;

            if (!byTeacher[teacherId]) {
                byTeacher[teacherId] = {
                    teacherName,
                    username,
                    count: 0,
                    cases: []
                };
            }

            byTeacher[teacherId].count++;
            byTeacher[teacherId].cases.push({
                student: firstWs.student?.name || 'Unknown',
                tokenNumber: firstWs.student?.tokenNumber || '-',
                class: `${firstWs.class.school.name} - ${firstWs.class.name}`,
                date: firstWs.submittedOn!.toISOString().split('T')[0],
                worksheets: wsList.map(ws => ({
                    worksheetNumber: ws.worksheetNumber || 0,
                    grade: ws.grade,
                    isAbsent: ws.isAbsent
                }))
            });
        }

        // Print summary by teacher
        const sortedTeachers = Object.values(byTeacher).sort((a, b) => b.count - a.count);

        for (const teacher of sortedTeachers) {
            console.log(`\nTeacher: ${teacher.teacherName} (${teacher.username}) - ${teacher.count} case(s)`);
            console.log('-'.repeat(100));

            for (const caseData of teacher.cases.slice(0, 10)) { // Show max 10 cases per teacher
                console.log(`  Student: ${caseData.student} (${caseData.tokenNumber})`);
                console.log(`  Class: ${caseData.class}`);
                console.log(`  Date: ${caseData.date}`);
                console.log(`  Worksheets: ${caseData.worksheets.map((w: any) =>
                    w.isAbsent ? 'Absent' : `WS#${w.worksheetNumber} (Grade: ${w.grade ?? 'N/A'})`
                ).join(', ')}`);
                console.log('');
            }

            if (teacher.cases.length > 10) {
                console.log(`  ... and ${teacher.cases.length - 10} more cases`);
            }
        }

        console.log('='.repeat(120));
        console.log('\nSummary:');
        console.log(`Total cases of multiple worksheets per student per day: ${multipleWorksheets.length}`);
        console.log(`Teachers with multiple worksheet uploads: ${sortedTeachers.length}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

findMultipleWorksheetsPerDay();
