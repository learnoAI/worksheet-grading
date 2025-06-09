const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTokenNumbers() {
  try {
    console.log('Checking token numbers in database...');
    
    const students = await prisma.user.findMany({
      where: {
        role: 'STUDENT'
      },
      select: {
        id: true,
        name: true,
        username: true,
        tokenNumber: true
      },
      orderBy: {
        tokenNumber: 'asc'
      }
    });
    
    console.log('Found ' + students.length + ' students');
    console.log('\nToken number examples:');
    
    const tokenFormats = {};
    students.forEach((student, index) => {
      if (student.tokenNumber) {
        // Analyze the format
        let format = 'Unknown';
        if (/^\d+$/.test(student.tokenNumber)) {
          format = 'Numbers only';
        } else if (/^\d+S\d+$/.test(student.tokenNumber)) {
          format = 'NumberSNumber (24S138 format)';
        } else {
          format = 'Other format';
        }
        
        tokenFormats[format] = (tokenFormats[format] || 0) + 1;
        
        // Show first 10 examples
        if (index < 10) {
          console.log('  ' + student.name + ': ' + student.tokenNumber + ' (' + format + ')');
        }
      } else {
        tokenFormats['NULL'] = (tokenFormats['NULL'] || 0) + 1;
        if (Object.keys(tokenFormats).length <= 10) {
          console.log('  ' + student.name + ': NULL');
        }
      }
    });
    
    console.log('\nToken format summary:');
    Object.entries(tokenFormats).forEach(([format, count]) => {
      console.log('  ' + format + ': ' + count + ' students');
    });
    
    // Check for specific 24S138 format examples
    const s24Format = students.filter(s => s.tokenNumber && s.tokenNumber.startsWith('24S'));
    console.log('\nStudents with 24S* format: ' + s24Format.length);
    s24Format.slice(0, 5).forEach(s => {
      console.log('  ' + s.name + ': ' + s.tokenNumber);
    });
    
    // Check for any validation issues
    console.log('\nValidation checks:');
    const duplicateTokens = {};
    const invalidTokens = [];
    
    students.forEach(student => {
      if (student.tokenNumber) {
        // Check for duplicates
        if (duplicateTokens[student.tokenNumber]) {
          duplicateTokens[student.tokenNumber].push(student);
        } else {
          duplicateTokens[student.tokenNumber] = [student];
        }
        
        // Check for invalid formats (non-alphanumeric)
        if (!/^[a-zA-Z0-9]+$/.test(student.tokenNumber)) {
          invalidTokens.push(student);
        }
      }
    });
    
    const duplicates = Object.entries(duplicateTokens).filter(([token, students]) => students.length > 1);
    if (duplicates.length > 0) {
      console.log('  Duplicate tokens found: ' + duplicates.length);
      duplicates.slice(0, 3).forEach(([token, students]) => {
        console.log('    Token ' + token + ' used by: ' + students.map(s => s.name).join(', '));
      });
    } else {
      console.log('  No duplicate tokens found');
    }
    
    if (invalidTokens.length > 0) {
      console.log('  Invalid token formats: ' + invalidTokens.length);
      invalidTokens.slice(0, 3).forEach(student => {
        console.log('    ' + student.name + ': ' + student.tokenNumber);
      });
    } else {
      console.log('  All tokens have valid formats');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTokenNumbers();
