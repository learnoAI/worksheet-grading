const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Test the complete workflow
async function testWorkflow() {
    try {
        // First, login to get a valid token
        console.log('Logging in to get token...');
        const loginResponse = await fetch('http://localhost:5100/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: 'superadmin',
                password: 'admin@saarthi'
            })
        });
        
        if (!loginResponse.ok) {
            throw new Error('Login failed');
        }
        
        const loginData = await loginResponse.json();
        const token = loginData.token;
        console.log('✅ Login successful, got token');
        
        console.log('Testing backend worksheet processing endpoint...');
        
        // Create a test form data
        const form = new FormData();
        form.append('token_no', '1001');
        form.append('worksheet_name', '1');
        
        // Create a dummy image file for testing
        const dummyImageBuffer = Buffer.from('dummy-image-data');
        form.append('files', dummyImageBuffer, {
            filename: 'test.jpg',
            contentType: 'image/jpeg'
        });
        
        // Test the backend endpoint with valid token
        const response = await fetch('http://localhost:5100/api/worksheet-processing/process', {
            method: 'POST',
            body: form,
            headers: {
                'Authorization': `Bearer ${token}`,
                ...form.getHeaders()
            }
        });
        
        const result = await response.text();
        console.log('Response status:', response.status);
        console.log('Response body:', result);
        
        if (response.ok) {
            console.log('✅ Backend endpoint is working!');
            try {
                const jsonResult = JSON.parse(result);
                if (jsonResult.success) {
                    console.log('✅ Python API integration successful!');
                    console.log('Grade:', jsonResult.grade);
                    console.log('MongoDB ID:', jsonResult.mongodb_id);
                } else {
                    console.log('❌ Python API returned error:', jsonResult.error);
                }
            } catch (parseError) {
                console.log('Response is not JSON:', result);
            }
        } else {
            console.log('❌ Backend endpoint failed');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testWorkflow();
