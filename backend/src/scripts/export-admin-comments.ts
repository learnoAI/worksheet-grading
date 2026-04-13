import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface WorksheetComment {
  worksheetNumber: number | null;
  adminComments: string;
  worksheetId: string;
  pageNumber: number;
  imageUrl: string;
  grade: number | null;
  outOf: number | null;
  studentId: string | null;
  submittedOn: Date | null;
}

interface GroupedComments {
  [pageNumber: number]: WorksheetComment[];
}

async function exportAdminComments() {
  try {
    console.log('Fetching worksheets with admin comments...');
    
    // Fetch all worksheets that have adminComments
    const worksheets = await prisma.worksheet.findMany({
      where: {
        adminComments: {
          not: null
        }
      },
      include: {
        template: true,
        images: {
          orderBy: {
            pageNumber: 'asc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`Found ${worksheets.length} worksheets with admin comments`);

    if (worksheets.length === 0) {
      console.log('No worksheets with admin comments found.');
      return;
    }

    // Process and group by page number
    const groupedComments: GroupedComments = {};

    for (const worksheet of worksheets) {
      const worksheetNumber = worksheet.worksheetNumber || null;
      
      // If worksheet has images, group by each image/page
      if (worksheet.images && worksheet.images.length > 0) {
        for (const image of worksheet.images) {
          const pageNumber = image.pageNumber;
          
          if (!groupedComments[pageNumber]) {
            groupedComments[pageNumber] = [];
          }

          groupedComments[pageNumber].push({
            worksheetNumber,
            adminComments: worksheet.adminComments!,
            worksheetId: worksheet.id,
            pageNumber,
            imageUrl: image.imageUrl,
            grade: worksheet.grade,
            outOf: worksheet.outOf,
            studentId: worksheet.studentId,
            submittedOn: worksheet.submittedOn
          });
        }
      } else {
        // If no images, group under page 0 (no page)
        const pageNumber = 0;
        
        if (!groupedComments[pageNumber]) {
          groupedComments[pageNumber] = [];
        }

        groupedComments[pageNumber].push({
          worksheetNumber,
          adminComments: worksheet.adminComments!,
          worksheetId: worksheet.id,
          pageNumber: 0,
          imageUrl: 'No image available',
          grade: worksheet.grade,
          outOf: worksheet.outOf,
          studentId: worksheet.studentId,
          submittedOn: worksheet.submittedOn
        });
      }
    }

    // Create test directory if it doesn't exist
    const testDir = path.join(__dirname, '..', '..', 'test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Save grouped comments to separate JSON files by page number
    for (const [pageNumber, comments] of Object.entries(groupedComments)) {
      const fileName = `admin-comments-page-${pageNumber}.json`;
      const filePath = path.join(testDir, fileName);
      
      const output = {
        pageNumber: parseInt(pageNumber),
        totalComments: comments.length,
        comments: comments.map((c: WorksheetComment) => ({
          worksheetNumber: c.worksheetNumber,
          worksheetId: c.worksheetId,
          adminComments: c.adminComments,
          imageUrl: c.imageUrl,
          grade: c.grade,
          outOf: c.outOf,
          studentId: c.studentId,
          submittedOn: c.submittedOn
        }))
      };

      fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
      console.log(`Saved ${comments.length} comments to ${fileName}`);
    }

    // Also create a summary file with all comments
    const summaryFilePath = path.join(testDir, 'admin-comments-all.json');
    const allComments = Object.values(groupedComments).flat();
    
    const summary = {
      totalWorksheets: worksheets.length,
      totalCommentsByPage: Object.keys(groupedComments).length,
      exportDate: new Date().toISOString(),
      commentsByPage: Object.entries(groupedComments).map(([pageNumber, comments]) => ({
        pageNumber: parseInt(pageNumber),
        count: comments.length,
        worksheetNumbers: [...new Set(comments.map((c: WorksheetComment) => c.worksheetNumber).filter((n: number | null) => n !== null))]
      })),
      allComments: allComments.map((c: WorksheetComment) => ({
        worksheetNumber: c.worksheetNumber,
        worksheetId: c.worksheetId,
        pageNumber: c.pageNumber,
        adminComments: c.adminComments,
        imageUrl: c.imageUrl,
        grade: c.grade,
        outOf: c.outOf,
        studentId: c.studentId,
        submittedOn: c.submittedOn
      }))
    };

    fs.writeFileSync(summaryFilePath, JSON.stringify(summary, null, 2));
    console.log(`\nSaved summary with all ${allComments.length} comments to admin-comments-all.json`);
    
    console.log('\n✅ Export completed successfully!');
    console.log(`Files saved in: ${testDir}`);

  } catch (error) {
    console.error('Error exporting admin comments:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
exportAdminComments()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
