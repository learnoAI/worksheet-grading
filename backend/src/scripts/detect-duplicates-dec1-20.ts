import prisma from '../utils/prisma';
import * as fs from 'fs';

// Date range: December 1-20, 2025
const START_DATE = new Date('2025-12-01T00:00:00.000Z');
const END_DATE = new Date('2025-12-22T23:59:59.999Z');

interface DuplicateGroup {
  key: string;
  studentId: string;
  classId: string;
  templateId: string;
  submittedOnDay: string;
  worksheets: Array<{
    id: string;
    createdAt: Date;
    grade: number | null;
    isRepeated: boolean;
  }>;
  keep: string;
  delete: string[];
}

async function detectDuplicates() {
  console.log('🔍 Detecting duplicates from Dec 1-20, 2025...\n');

  // Fetch all worksheets in date range (excluding intentional repeats)
  const worksheets = await prisma.worksheet.findMany({
    where: {
      submittedOn: {
        gte: START_DATE,
        lte: END_DATE
      },
      isRepeated: false // Exclude intentional repeats
    },
    select: {
      id: true,
      studentId: true,
      classId: true,
      templateId: true,
      submittedOn: true,
      createdAt: true,
      grade: true,
      isRepeated: true,
      student: { select: { name: true, tokenNumber: true } },
      class: { select: { name: true, school: { select: { name: true } } } }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`📊 Found ${worksheets.length} worksheets in date range\n`);

  // Group by student + class + template + day
  const groups = new Map<string, typeof worksheets>();

  for (const ws of worksheets) {
    if (!ws.studentId || !ws.templateId || !ws.submittedOn) continue;

    const day = ws.submittedOn.toISOString().split('T')[0];
    const key = `${ws.studentId}|${ws.classId}|${ws.templateId}|${day}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(ws);
  }

  // Find duplicate groups (count > 1)
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [key, group] of groups) {
    if (group.length > 1) {
      // Sort by createdAt ascending - keep oldest
      group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const [first, ...rest] = group;
      duplicateGroups.push({
        key,
        studentId: first.studentId!,
        classId: first.classId,
        templateId: first.templateId!,
        submittedOnDay: first.submittedOn!.toISOString().split('T')[0],
        worksheets: group.map(w => ({
          id: w.id,
          createdAt: w.createdAt,
          grade: w.grade,
          isRepeated: w.isRepeated
        })),
        keep: first.id,
        delete: rest.map(w => w.id)
      });
    }
  }

  const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.delete.length, 0);

  console.log(`🔢 Found ${duplicateGroups.length} duplicate groups`);
  console.log(`🗑️  Total duplicates to delete: ${totalDuplicates}\n`);

  // Group by day for summary
  const byDay = new Map<string, number>();
  for (const g of duplicateGroups) {
    const day = g.submittedOnDay;
    byDay.set(day, (byDay.get(day) || 0) + g.delete.length);
  }

  console.log('📅 Duplicates by day:');
  for (const [day, count] of [...byDay.entries()].sort()) {
    console.log(`   ${day}: ${count}`);
  }

  // Save report
  const report = {
    generatedAt: new Date().toISOString(),
    dateRange: { start: START_DATE.toISOString(), end: END_DATE.toISOString() },
    summary: {
      totalWorksheets: worksheets.length,
      duplicateGroups: duplicateGroups.length,
      totalDuplicatesToDelete: totalDuplicates
    },
    byDay: Object.fromEntries(byDay),
    groups: duplicateGroups
  };

  fs.writeFileSync('duplicates-dec1-20.json', JSON.stringify(report, null, 2));
  console.log('\n✅ Report saved to duplicates-dec1-20.json');

  await prisma.$disconnect();
  return report;
}

detectDuplicates().catch(console.error);
