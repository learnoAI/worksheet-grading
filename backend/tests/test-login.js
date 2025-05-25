const https = require('https');
const http = require('http');

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
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testLogin() {
  try {
    // Test login
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
    
    console.log('Testing login for teacher sanjana...');
    const loginResponse = await makeRequest(loginOptions, loginData);
    console.log('Login response:', loginResponse);
    
    if (loginResponse.token) {      // Test protected route - get teacher's classes
      const worksheetOptions = {
        hostname: 'localhost',
        port: 5100,
        path: `/api/worksheets/teacher/${loginResponse.user.id}/classes`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${loginResponse.token}`
        }
      };
      
      console.log('Testing teacher classes access...');
      const worksheetResponse = await makeRequest(worksheetOptions);
      console.log('Teacher classes response:', Array.isArray(worksheetResponse) ? `Found ${worksheetResponse.length} classes` : worksheetResponse);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLogin();
