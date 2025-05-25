const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function testFrontendRequest() {
    try {
        console.log('=== TESTING FRONTEND REQUEST SIMULATION ===');
        
        // 1. Login first to get token
        console.log('1. Logging in...');
        const loginResponse = await axios.post('http://localhost:5100/api/auth/login', {
            username: 'sanjana',
            password: 'saarthi@123'
        });
        
        const token = loginResponse.data.token;
        console.log('✓ Login successful, got token');
        
        // 2. Test the exact endpoint the frontend is calling
        const frontendApiUrl = 'http://localhost:5100/api';
        const endpoint = `${frontendApiUrl}/worksheet-processing/process`;
        
        console.log(`2. Testing endpoint: ${endpoint}`);
        
        // Create FormData exactly like frontend
        const formData = new FormData();
        
        // Add metadata fields
        formData.append('classId', '192ed530-eee6-4822-8d9c-07dfa111ca02');
        formData.append('studentId', '06af26fe-f71a-40bb-a6c1-88ea336f01b4');
        formData.append('worksheetNumber', '113');
        formData.append('submittedOn', new Date().toISOString());
        
        // Add Python API fields
        formData.append('token_no', '24S030');
        formData.append('worksheet_name', '113');
        
        // Add test files
        const file1Path = 'c:\\Users\\ayamu\\python-programs\\Git-Uploads\\learnoai\\saarthiEd\\saarthiEd-backend\\sw\\1000123921.jpg';
        const file2Path = 'c:\\Users\\ayamu\\python-programs\\Git-Uploads\\learnoai\\saarthiEd\\saarthiEd-backend\\sw\\1000123922.jpg';
        
        if (fs.existsSync(file1Path)) {
            formData.append('files', fs.createReadStream(file1Path));
            console.log('✓ Added file 1');
        }
        if (fs.existsSync(file2Path)) {
            formData.append('files', fs.createReadStream(file2Path));
            console.log('✓ Added file 2');
        }
        
        // Make the request with the same headers as frontend
        const response = await axios.post(endpoint, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('✓ Request successful!');
        console.log('Response:', response.data);
        
    } catch (error) {
        console.error('✗ Request failed:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

testFrontendRequest();
