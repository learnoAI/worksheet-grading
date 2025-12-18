import prisma from '../utils/prisma';
import * as fs from 'fs';

interface DuplicateGroup {
    key: string;
    keep: string;
    delete: string[];
}

interface Report {
    groups: DuplicateGroup[];
}

async function removeDuplicates() {
    console.log('🗑️  Removing duplicates from Dec 1-20, 2025...\n');

    // Read the report
    if (!fs.existsSync('duplicates-dec1-20.json')) {
        console.error('❌ Report file not found. Run detect-duplicates-dec1-20.ts first.');
        process.exit(1);
    }

    const report: Report = JSON.parse(fs.readFileSync('duplicates-dec1-20.json', 'utf-8'));

    const allToDelete = report.groups.flatMap(g => g.delete);
    console.log(`📊 Found ${allToDelete.length} duplicates to delete\n`);

    if (allToDelete.length === 0) {
        console.log('✅ No duplicates to delete!');
        await prisma.$disconnect();
        return;
    }

    // Delete related records first (foreign key constraints)
    console.log('🔗 Deleting related WorksheetImages...');
    const deletedImages = await prisma.worksheetImage.deleteMany({
        where: { worksheetId: { in: allToDelete } }
    });
    console.log(`   Deleted ${deletedImages.count} images`);

    console.log('🔗 Deleting related WorksheetQuestions...');
    const deletedQuestions = await prisma.worksheetQuestion.deleteMany({
        where: { worksheetId: { in: allToDelete } }
    });
    console.log(`   Deleted ${deletedQuestions.count} questions`);

    // Delete duplicate worksheets
    console.log('📝 Deleting duplicate worksheets...');
    const deletedWorksheets = await prisma.worksheet.deleteMany({
        where: { id: { in: allToDelete } }
    });
    console.log(`   Deleted ${deletedWorksheets.count} worksheets\n`);

    // Save deletion log
    const log = {
        deletedAt: new Date().toISOString(),
        imagesDeleted: deletedImages.count,
        questionsDeleted: deletedQuestions.count,
        worksheetsDeleted: deletedWorksheets.count
    };

    fs.writeFileSync('deletion-log-dec1-20.json', JSON.stringify(log, null, 2));
    console.log('✅ Deletion complete! Log saved to deletion-log-dec1-20.json');

    await prisma.$disconnect();
}

removeDuplicates().catch(console.error);
