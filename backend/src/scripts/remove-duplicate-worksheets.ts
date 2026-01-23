import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
});

interface WorksheetRecord {
    id: string;
    studentId: string | null;
    classId: string;
    templateId: string | null;
    submittedOn: Date | null;
    grade: number | null;
    isAbsent: boolean;
    isRepeated: boolean;
    createdAt: Date;
    template: { worksheetNumber: number } | null;
    student: { name: string; tokenNumber: number } | null;
    submittedBy: { id: string; name: string; username: string };
    class: { name: string; school: { name: string } };
}

async function removeDuplicateWorksheets() {
    try {
        console.log('Connecting to database...\n');
        console.log('Finding duplicate worksheets...');
        console.log('Grouping by: [studentId, classId, templateId, submittedOn]\n');

        // Find all cases where a student has multiple worksheets on the same day in the same class
        // Duplicates are defined by the unique constraint: [studentId, classId, templateId, submittedOn, isRepeated]
        const worksheets = await prisma.worksheet.findMany({
            where: {
                studentId: { not: null },
                submittedOn: { not: null }
            },
            select: {
                id: true,
                studentId: true,
                classId: true,
                templateId: true,
                submittedOn: true,
                grade: true,
                isAbsent: true,
                isRepeated: true,
                createdAt: true,
                template: {
                    select: {
                        worksheetNumber: true
                    }
                },
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
        }) as unknown as WorksheetRecord[];

        // Group by student + class + template + date
        // Duplicates = same student, same class, same worksheet number, same date
        const grouped: Record<string, WorksheetRecord[]> = {};

        for (const ws of worksheets) {
            if (!ws.studentId || !ws.submittedOn) continue;

            // Normalize date to midnight UTC (same as the controller does)
            const normalizedDate = new Date(ws.submittedOn);
            normalizedDate.setUTCHours(0, 0, 0, 0);
            const dateStr = normalizedDate.toISOString();

            const templateKey = ws.templateId || 'null';
            const key = `${ws.studentId}|${ws.classId}|${templateKey}|${dateStr}`;

            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(ws);
        }

        // Filter to only cases with multiple worksheets
        const multipleWorksheets = Object.entries(grouped)
            .filter(([_, wsList]) => wsList.length > 1)
            .sort((a, b) => {
                const dateA = a[1][0].submittedOn!;
                const dateB = b[1][0].submittedOn!;
                return dateB.getTime() - dateA.getTime();
            });

        if (multipleWorksheets.length === 0) {
            console.log('No duplicate worksheets found. Database is clean!');
            return;
        }

        // Prepare report
        const report: string[] = [];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        report.push(`Duplicate Worksheets Report - ${new Date().toISOString()}`);
        report.push('='.repeat(120));
        report.push(`Grouping by: [studentId, classId, templateId, submittedOn]`);
        report.push(`Found ${multipleWorksheets.length} cases of duplicate worksheets\n`);

        // Track worksheets to delete
        const worksheetsToDelete: string[] = [];
        const worksheetsToKeep: { id: string; reason: string; details: string }[] = [];

        for (const [key, wsList] of multipleWorksheets) {
            const firstWs = wsList[0];
            const studentName = firstWs.student?.name || 'Unknown';
            const tokenNumber = firstWs.student?.tokenNumber || '-';
            const className = `${firstWs.class.school.name} - ${firstWs.class.name}`;
            const date = firstWs.submittedOn!.toISOString().split('T')[0];
            const worksheetNum = firstWs.template?.worksheetNumber || 'N/A';

            report.push(`\nStudent: ${studentName} (Token: ${tokenNumber})`);
            report.push(`Class: ${className}`);
            report.push(`Date: ${date}`);
            report.push(`Worksheet #: ${worksheetNum}`);
            report.push(`Is Repeated: ${firstWs.isRepeated}`);
            report.push(`Teacher: ${firstWs.submittedBy.name} (${firstWs.submittedBy.username})`);
            report.push(`Total duplicate worksheets found: ${wsList.length}`);
            report.push('-'.repeat(80));

            // Determine which worksheet to keep:
            // Priority: 1) Has a grade (not null), 2) Not marked absent, 3) Most recent createdAt
            const sortedList = [...wsList].sort((a, b) => {
                // Prioritize worksheets with grades
                if (a.grade !== null && b.grade === null) return -1;
                if (a.grade === null && b.grade !== null) return 1;

                // Prioritize non-absent worksheets
                if (!a.isAbsent && b.isAbsent) return -1;
                if (a.isAbsent && !b.isAbsent) return 1;

                // Keep the most recently created one
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

            const keepWorksheet = sortedList[0];
            const deleteWorksheets = sortedList.slice(1);

            let keepReason = 'Most recent';
            if (keepWorksheet.grade !== null) {
                keepReason = 'Has grade';
            } else if (!keepWorksheet.isAbsent) {
                keepReason = 'Not marked absent';
            }

            report.push(`\n  KEEPING (${keepReason}):`);
            report.push(`    ID: ${keepWorksheet.id}`);
            report.push(`    Worksheet #: ${keepWorksheet.template?.worksheetNumber || 'N/A'}`);
            report.push(`    Grade: ${keepWorksheet.grade ?? 'N/A'}`);
            report.push(`    Absent: ${keepWorksheet.isAbsent}`);
            report.push(`    Created: ${keepWorksheet.createdAt}`);

            worksheetsToKeep.push({
                id: keepWorksheet.id,
                reason: keepReason,
                details: `${studentName} - ${className} - ${date}`
            });

            report.push(`\n  DELETING (${deleteWorksheets.length} worksheet(s)):`);
            for (const ws of deleteWorksheets) {
                report.push(`    ID: ${ws.id}`);
                report.push(`    Worksheet #: ${ws.template?.worksheetNumber || 'N/A'}`);
                report.push(`    Grade: ${ws.grade ?? 'N/A'}`);
                report.push(`    Absent: ${ws.isAbsent}`);
                report.push(`    Created: ${ws.createdAt}`);
                report.push('');
                worksheetsToDelete.push(ws.id);
            }

            report.push('');
        }

        report.push('='.repeat(120));
        report.push('\nSUMMARY:');
        report.push(`Total duplicate groups: ${multipleWorksheets.length}`);
        report.push(`Worksheets to keep (one per group): ${worksheetsToKeep.length}`);
        report.push(`Worksheets to delete (duplicates): ${worksheetsToDelete.length}`);

        // Save report to file
        const reportDir = path.join(__dirname, '../../reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        const reportPath = path.join(reportDir, `duplicate-worksheets-${timestamp}.txt`);
        fs.writeFileSync(reportPath, report.join('\n'));
        console.log(`\nReport saved to: ${reportPath}`);

        // Print summary to console
        console.log('\n' + '='.repeat(120));
        console.log('SUMMARY:');
        console.log(`Total duplicate groups: ${multipleWorksheets.length}`);
        console.log(`Worksheets to keep (one per group): ${worksheetsToKeep.length}`);
        console.log(`Worksheets to delete (duplicates): ${worksheetsToDelete.length}`);
        console.log('='.repeat(120));

        if (worksheetsToDelete.length === 0) {
            console.log('\nNo worksheets to delete.');
            return;
        }

        // Confirm deletion
        console.log('\n⚠️  PROCEEDING WITH DELETION...\n');

        // Delete duplicates in batches
        const batchSize = 100;
        let deletedCount = 0;

        for (let i = 0; i < worksheetsToDelete.length; i += batchSize) {
            const batch = worksheetsToDelete.slice(i, i + batchSize);

            const result = await prisma.worksheet.deleteMany({
                where: {
                    id: { in: batch }
                }
            });

            deletedCount += result.count;
            console.log(`Deleted batch ${Math.floor(i / batchSize) + 1}: ${result.count} worksheets`);
        }

        console.log(`\n✅ Successfully deleted ${deletedCount} duplicate worksheets.`);
        console.log(`Report saved to: ${reportPath}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

removeDuplicateWorksheets();
