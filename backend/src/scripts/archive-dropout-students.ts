#!/usr/bin/env node

/**
 * Script to archive dropout students based on their token numbers
 * This script reads CSV files containing dropout student data and archives them in the database
 */

import * as fs from 'fs';
import * as path from 'path';
import prisma from '../utils/prisma';

interface StudentData {
  tokenNumber: string;
  studentName: string;
  schoolName: string;
  className: string;
  source: string;
}

interface ArchiveResult {
  tokenNumber: string;
  studentName: string;
  status: 'ARCHIVED' | 'NOT_FOUND' | 'ALREADY_ARCHIVED' | 'ERROR';
  message: string;
}

interface ArchiveSummary {
  totalProcessed: number;
  archived: number;
  notFound: number;
  alreadyArchived: number;
  errors: number;
  details: ArchiveResult[];
}

/**
 * Parse CSV file and extract token numbers
 * @param filePath - Path to the CSV file
 * @returns Array of objects with student data
 */
function parseCSV(filePath: string): StudentData[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const header = lines[0].split(',');
    
    // Find the index of the Token Number column
    const tokenIndex = header.findIndex(col => col.trim().toLowerCase().includes('token'));
    const nameIndex = header.findIndex(col => col.trim().toLowerCase().includes('name') && !col.trim().toLowerCase().includes('school'));
    const schoolIndex = header.findIndex(col => col.trim().toLowerCase().includes('school name'));
    const classIndex = header.findIndex(col => col.trim().toLowerCase().includes('class'));
    
    if (tokenIndex === -1) {
      throw new Error(`Token Number column not found in ${filePath}`);
    }
    
    const students: StudentData[] = [];
    
    // Skip header and process data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines
      
      const columns = line.split(',');
      if (columns.length > tokenIndex && columns[tokenIndex].trim()) {
        students.push({
          tokenNumber: columns[tokenIndex].trim(),
          studentName: nameIndex !== -1 ? columns[nameIndex].trim() : '',
          schoolName: schoolIndex !== -1 ? columns[schoolIndex].trim() : '',
          className: classIndex !== -1 ? columns[classIndex].trim() : '',
          source: path.basename(filePath)
        });
      }
    }
    
    return students;
  } catch (error) {
    console.error(`Error parsing CSV file ${filePath}:`, (error as Error).message);
    return [];
  }
}

/**
 * Archive students by token numbers
 * @param students - Array of student objects with token numbers
 * @returns Results summary
 */
async function archiveStudents(students: StudentData[]): Promise<ArchiveSummary> {
  const results: ArchiveSummary = {
    totalProcessed: 0,
    archived: 0,
    notFound: 0,
    alreadyArchived: 0,
    errors: 0,
    details: []
  };
  
  console.log(`\nProcessing ${students.length} students for archival...\n`);
  
  for (const student of students) {
    results.totalProcessed++;
    
    try {
      // Find student by token number
      const existingStudent = await prisma.user.findUnique({
        where: {
          tokenNumber: student.tokenNumber,
          role: 'STUDENT'
        },
        select: {
          id: true,
          name: true,
          tokenNumber: true,
          isArchived: true
        }
      });
      
      if (!existingStudent) {
        results.notFound++;
        results.details.push({
          tokenNumber: student.tokenNumber,
          studentName: student.studentName,
          status: 'NOT_FOUND',
          message: 'Student not found in database'
        });
        console.log(`❌ Student ${student.tokenNumber} (${student.studentName}) not found`);
        continue;
      }
      
      if (existingStudent.isArchived) {
        results.alreadyArchived++;
        results.details.push({
          tokenNumber: student.tokenNumber,
          studentName: existingStudent.name,
          status: 'ALREADY_ARCHIVED',
          message: 'Student was already archived'
        });
        console.log(`⚠️  Student ${student.tokenNumber} (${existingStudent.name}) already archived`);
        continue;
      }
      
      // Archive the student
      await prisma.user.update({
        where: {
          id: existingStudent.id
        },
        data: {
          isArchived: true
        }
      });
      
      results.archived++;
      results.details.push({
        tokenNumber: student.tokenNumber,
        studentName: existingStudent.name,
        status: 'ARCHIVED',
        message: 'Student successfully archived'
      });
      console.log(`✅ Student ${student.tokenNumber} (${existingStudent.name}) archived successfully`);
      
    } catch (error) {
      results.errors++;
      results.details.push({
        tokenNumber: student.tokenNumber,
        studentName: student.studentName,
        status: 'ERROR',
        message: (error as Error).message
      });
      console.error(`❌ Error processing ${student.tokenNumber}:`, (error as Error).message);
    }
  }
  
  return results;
}

/**
 * Generate a detailed report
 * @param results - Results from archiving process
 * @param allStudents - All students from CSV files
 */
function generateReport(results: ArchiveSummary, allStudents: StudentData[]): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(__dirname, `archive-report-${timestamp}.json`);
  
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalStudentsInCSV: allStudents.length,
      totalProcessed: results.totalProcessed,
      archived: results.archived,
      notFound: results.notFound,
      alreadyArchived: results.alreadyArchived,
      errors: results.errors
    },
    sourceFiles: [...new Set(allStudents.map(s => s.source))],
    details: results.details
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('ARCHIVAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total students in CSV files: ${report.summary.totalStudentsInCSV}`);
  console.log(`Total processed: ${report.summary.totalProcessed}`);
  console.log(`Successfully archived: ${report.summary.archived}`);
  console.log(`Already archived: ${report.summary.alreadyArchived}`);
  console.log(`Not found in database: ${report.summary.notFound}`);
  console.log(`Errors encountered: ${report.summary.errors}`);
  console.log(`\nDetailed report saved to: ${reportPath}`);
  console.log('='.repeat(60));
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('🚀 Starting student archival process...');
    
    // Define paths to CSV files (relative to the root directory)
    const csvFiles = [
      path.join(__dirname, '..', '..', '..', 'dropouts', 'Badarpur Center Log - Badarpur Drop Out Students (1).csv'),
      path.join(__dirname, '..', '..', '..', 'dropouts', 'Sangam Center Log - Sangam Vihar Drop Out Students.csv')
    ];
    
    // Check if CSV files exist
    const existingFiles = csvFiles.filter(file => fs.existsSync(file));
    if (existingFiles.length === 0) {
      throw new Error('No CSV files found in the dropouts directory');
    }
    
    console.log(`Found ${existingFiles.length} CSV file(s):`);
    existingFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
    
    // Parse all CSV files
    let allStudents: StudentData[] = [];
    for (const file of existingFiles) {
      console.log(`\nParsing ${path.basename(file)}...`);
      const students = parseCSV(file);
      console.log(`  Found ${students.length} students`);
      allStudents = allStudents.concat(students);
    }
    
    // Remove duplicates based on token number
    const uniqueStudents = allStudents.filter((student, index, self) => 
      index === self.findIndex(s => s.tokenNumber === student.tokenNumber)
    );
    
    if (allStudents.length !== uniqueStudents.length) {
      console.log(`\n⚠️  Removed ${allStudents.length - uniqueStudents.length} duplicate token numbers`);
    }
    
    console.log(`\nTotal unique students to process: ${uniqueStudents.length}`);
    
    // Confirm before proceeding
    if (process.argv.includes('--dry-run')) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made to the database');
      console.log('Students that would be processed:');
      uniqueStudents.forEach((student, index) => {
        console.log(`  ${index + 1}. ${student.tokenNumber} - ${student.studentName} (${student.schoolName})`);
      });
      return;
    }
    
    if (!process.argv.includes('--confirm')) {
      console.log('\n⚠️  This operation will archive students in the database.');
      console.log('Run with --confirm to proceed, or --dry-run to see what would be processed.');
      console.log('Example: npm run archive-dropouts -- --confirm');
      return;
    }
    
    // Archive students
    const results = await archiveStudents(uniqueStudents);
    
    // Generate report
    generateReport(results, allStudents);
    
  } catch (error) {
    console.error('❌ Fatal error:', (error as Error).message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle command line arguments and run
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
