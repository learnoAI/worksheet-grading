const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function makeRequest(options, data) {
  return new Promise((resolve, reject) => {
    const protocol = options.port === 443 ? https : http;
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      if (typeof data === 'string') {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

function makeFormRequest(options, formData) {
  return new Promise((resolve, reject) => {
    const protocol = options.port === 443 ? https : http;
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    
    req.on('error', reject);
    
    if (formData) {
      req.write(formData);
    }
    req.end();
  });
}

async function testCompleteWorkflow() {
  try {
    console.log('=== TESTING COMPLETE WORKSHEET UPLOAD WORKFLOW ===\n');
    
    // Step 1: Login as teacher
    console.log('1. Logging in as teacher sanjana...');
    const loginOptions = {
      hostname: 'localhost',
      port: 5100,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const loginData = {
      username: 'sanjana',
      password: 'saarthi@123'
    };
    
    const loginResponse = await makeRequest(loginOptions, loginData);
    
    if (!loginResponse.token) {
      console.error('Login failed:', loginResponse);
      return;
    }
    
    console.log('✓ Login successful');
    console.log('  User ID:', loginResponse.user.id);
    console.log('  Role:', loginResponse.user.role);
    
    const token = loginResponse.token;
    const teacherId = loginResponse.user.id;
    
    // Step 2: Get teacher's classes
    console.log('\n2. Getting teacher classes...');
    const classesOptions = {
      hostname: 'localhost',
      port: 5100,
      path: `/api/worksheets/teacher/${teacherId}/classes`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    
    const classesResponse = await makeRequest(classesOptions);
    
    if (!Array.isArray(classesResponse) || classesResponse.length === 0) {
      console.error('No classes found for teacher:', classesResponse);
      return;
    }
    
    console.log('✓ Found', classesResponse.length, 'classes');
    
    // Use the first class for testing
    const testClass = classesResponse[0];
    console.log('  Using class:', testClass.name, '(ID:', testClass.id + ')');
    
    // Step 3: Get students in the class
    console.log('\n3. Getting students in class...');
    const studentsOptions = {
      hostname: 'localhost',
      port: 5100,
      path: `/api/worksheets/class/${testClass.id}/students`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    
    const studentsResponse = await makeRequest(studentsOptions);
    
    if (!Array.isArray(studentsResponse) || studentsResponse.length === 0) {
      console.error('No students found in class:', studentsResponse);
      return;
    }
    
    console.log('✓ Found', studentsResponse.length, 'students in class');
    
    // Use the first two students for testing the two images
    const student1 = studentsResponse[0];
    const student2 = studentsResponse.length > 1 ? studentsResponse[1] : studentsResponse[0];
    
    console.log('  Student 1:', student1.name, '(ID:', student1.id + ')');
    console.log('  Student 2:', student2.name, '(ID:', student2.id + ')');
      // Step 4: Test worksheet processing with MULTIPLE images for a SINGLE student
    const imagePaths = [
      'c:\\Users\\ayamu\\python-programs\\Git-Uploads\\learnoai\\saarthiEd\\saarthiEd-backend\\sw\\1000123921.jpg',
      'c:\\Users\\ayamu\\python-programs\\Git-Uploads\\learnoai\\saarthiEd\\saarthiEd-backend\\sw\\1000123922.jpg'
    ];
      const testStudent = student1; // Use Tushar for both images (single student, multiple pages)
    const worksheetNumber = 113;  // Try worksheet 1 instead of 113
    
    console.log('\n4. Processing MULTIPLE worksheet images for SINGLE student...');
    console.log(`   Processing ${imagePaths.length} images for student: ${testStudent.name} (${testStudent.tokenNumber})`);
    
    // Verify both images exist
    const existingImages = imagePaths.filter(imagePath => {
      if (fs.existsSync(imagePath)) {
        console.log(`   ✓ Found: ${path.basename(imagePath)}`);
        return true;
      } else {
        console.error(`   ✗ Missing: ${imagePath}`);
        return false;
      }
    });
    
    if (existingImages.length === 0) {
      console.error('   No images found, skipping test');
      return;
    }
    
    // Create form data boundary
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    
    // Build form data with ALL metadata fields
    let formData = '';
    
    // Add token_no (student's token number)
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="token_no"\r\n\r\n`;
    formData += `${testStudent.tokenNumber}\r\n`;
    
    // Add worksheet_name (worksheet number)
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="worksheet_name"\r\n\r\n`;
    formData += `${worksheetNumber}\r\n`;
    
    // Add classId for database record
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="classId"\r\n\r\n`;
    formData += `${testClass.id}\r\n`;
    
    // Add studentId for database record
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="studentId"\r\n\r\n`;
    formData += `${testStudent.id}\r\n`;
    
    // Add worksheetNumber for database record
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="worksheetNumber"\r\n\r\n`;
    formData += `${worksheetNumber}\r\n`;
    
    // Add ALL image files
    const imageBuffers = [];
    for (const imagePath of existingImages) {
      const imageBuffer = fs.readFileSync(imagePath);
      const fileName = path.basename(imagePath);
      
      formData += `--${boundary}\r\n`;
      formData += `Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n`;
      formData += `Content-Type: image/jpeg\r\n\r\n`;
      
      imageBuffers.push(imageBuffer);
      imageBuffers.push(Buffer.from(`\r\n`, 'utf8'));
    }
    
    // Complete the form data
    const formDataEnd = Buffer.from(`--${boundary}--\r\n`, 'utf8');
    
    // Combine all buffers
    const formDataBuffer = Buffer.concat([
      Buffer.from(formData, 'utf8'),
      ...imageBuffers,
      formDataEnd
    ]);
    
    const processOptions = {
      hostname: 'localhost',
      port: 5100,
      path: '/api/worksheet-processing/process',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formDataBuffer.length
      }
    };
    
    console.log('   Uploading ALL images to Python API for grading...');
    
    // Make the request
    const processResponse = await new Promise((resolve, reject) => {
      const protocol = http;
      const req = protocol.request(processOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        });
      });
      
      req.on('error', reject);
      req.write(formDataBuffer);
      req.end();
    });
    
    if (processResponse.success) {
      console.log('   ✓ Successfully processed all worksheet images');
      console.log('     Worksheet ID:', processResponse.worksheetId || 'Not provided');
      console.log('     MongoDB ID:', processResponse.mongoDbId || 'Not provided');
      console.log('     Total Score:', processResponse.totalScore || 'N/A');
      console.log('     Correct Answers:', processResponse.correctAnswers || 'N/A');
      console.log('     Wrong Answers:', processResponse.wrongAnswers || 'N/A');
      console.log('     Grade:', processResponse.grade || 'N/A');
    } else {
      console.log('   ✗ Processing failed:', processResponse.message || processResponse);
    }
      // Step 5: Verify worksheets were stored in database
    console.log('\n5. Verifying worksheets in database...');
    const worksheetsOptions = {
      hostname: 'localhost',
      port: 5100,
      path: `/api/worksheets/class/${testClass.id}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    
    const worksheetsResponse = await makeRequest(worksheetsOptions);
    
    if (Array.isArray(worksheetsResponse)) {
      const recentWorksheets = worksheetsResponse.filter(w => w.worksheetNumber === worksheetNumber);
      console.log('✓ Found', recentWorksheets.length, 'worksheets with number', worksheetNumber, 'in class');
      
      recentWorksheets.forEach(worksheet => {
        console.log(`  - ID: ${worksheet.id}, Student: ${worksheet.studentId}, MongoDB ID: ${worksheet.mongoDbId || 'None'}`);
      });
    } else {
      console.log('   Could not retrieve worksheets:', worksheetsResponse);
    }
    
    console.log('\n=== WORKFLOW TEST COMPLETED ===');
    
  } catch (error) {
    console.error('Workflow test error:', error.message);
  }
}

testCompleteWorkflow();
