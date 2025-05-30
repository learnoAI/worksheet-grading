const axios = require('axios');

async function simpleTest() {
    try {
        console.log('Testing basic server connection...');
        
        const response = await axios.get('http://localhost:5100/api/health', {
            timeout: 5000
        });
        
        console.log('Server health check:', response.status);
        
    } catch (error) {
        console.error('Health check failed:', error.message);
        
        // Try login test
        console.log('Trying login test...');
        try {
            const loginResponse = await axios.post('http://localhost:5100/api/auth/login', {
                username: 'sanjana',
                password: '123456'
            }, {
                timeout: 10000
            });
            
            console.log('Login successful:', loginResponse.data.user.username);
        } catch (loginError) {
            console.error('Login failed:', loginError.response?.data || loginError.message);
        }
    }
}

simpleTest();
