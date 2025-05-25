const axios = require('axios');

async function testSimple() {
    try {
        console.log('Testing simple GET request to health endpoint...');
        const healthResponse = await axios.get('http://localhost:5100/health');
        console.log('✓ Health check:', healthResponse.data);
        
        console.log('Testing POST to worksheet-processing endpoint without auth...');
        const response = await axios.post('http://localhost:5100/api/worksheet-processing/process', {});
        console.log('✓ Response:', response.data);
        
    } catch (error) {
        console.error('✗ Error:');
        console.error('Status:', error.response?.status);
        console.error('Status Text:', error.response?.statusText);
        console.error('Data:', error.response?.data);
        console.error('URL:', error.config?.url);
    }
}

testSimple();
