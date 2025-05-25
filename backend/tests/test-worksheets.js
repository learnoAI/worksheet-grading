// Test to find working worksheet numbers
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

async function testWorksheetNumbers() {
  try {
    console.log('=== TESTING DIFFERENT WORKSHEET NUMBERS ===\n');
    
    // Login first
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
    const token = loginResponse.token;
    
    // Test worksheet numbers 1-5 with the first image
    const imagePath = 'c:\\Users\\ayamu\\python-programs\\Git-Uploads\\learnoai\\saarthiEd\\saarthiEd-backend\\sw\\1000123921.jpg';
    const imageBuffer = fs.readFileSync(imagePath);
    const fileName = path.basename(imagePath);
    
    for (let worksheetNumber = 1; worksheetNumber <= 5; worksheetNumber++) {
      console.log(`Testing worksheet number ${worksheetNumber}...`);
      
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      
      let formData = '';
      formData += `--${boundary}\r\n`;
      formData += `Content-Disposition: form-data; name="token_no"\r\n\r\n`;
      formData += `test-${Date.now()}\r\n`;
      
      formData += `--${boundary}\r\n`;
      formData += `Content-Disposition: form-data; name="worksheet_name"\r\n\r\n`;
      formData += `Worksheet-${worksheetNumber}-Test\r\n`;
      
      formData += `--${boundary}\r\n`;
      formData += `Content-Disposition: form-data; name="classId"\r\n\r\n`;
      formData += `test-class\r\n`;
      
      formData += `--${boundary}\r\n`;
      formData += `Content-Disposition: form-data; name="studentId"\r\n\r\n`;
      formData += `test-student\r\n`;
      
      formData += `--${boundary}\r\n`;
      formData += `Content-Disposition: form-data; name="worksheetNumber"\r\n\r\n`;
      formData += `${worksheetNumber}\r\n`;
      
      formData += `--${boundary}\r\n`;
      formData += `Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n`;
      formData += `Content-Type: image/jpeg\r\n\r\n`;
      
      const formDataBuffer = Buffer.concat([
        Buffer.from(formData, 'utf8'),
        imageBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
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
        console.log(`✓ Worksheet ${worksheetNumber} EXISTS and works!`);
        console.log(`  Score: ${processResponse.totalScore}`);
        console.log(`  Correct: ${processResponse.correctAnswers}`);
        console.log(`  Wrong: ${processResponse.wrongAnswers}`);
        console.log(`  MongoDB ID: ${processResponse.mongoDbId}`);
      } else {
        console.log(`✗ Worksheet ${worksheetNumber}: ${processResponse.error || processResponse.message}`);
      }
      
      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
  } catch (error) {
    console.error('Test error:', error.message);
  }
}

testWorksheetNumbers();
