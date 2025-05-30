const axios = require('axios');

const baseURL = 'http://localhost:5100/api';

async function testArchivedClassesFilter() {
    try {
        console.log('Testing archived classes filtering...');
          // First, login as a teacher
        const loginResponse = await axios.post(`${baseURL}/auth/login`, {
            username: 'sanjana',
            password: 'saarthi@123'
        }, {
            timeout: 10000
        });
        
        const token = loginResponse.data.token;
        const teacherId = loginResponse.data.user.id;
        
        console.log('Login successful, teacher ID:', teacherId);
          // Get teacher classes
        const classesResponse = await axios.get(`${baseURL}/worksheets/teacher/${teacherId}/classes`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 10000
        });
        
        const classes = classesResponse.data;
        console.log('Teacher classes returned:', classes.length);
        
        // Check if any archived classes are returned
        const archivedClasses = classes.filter(cls => cls.isArchived === true);
        
        if (archivedClasses.length > 0) {
            console.log('❌ FAILED: Found archived classes in teacher view:');
            archivedClasses.forEach(cls => {
                console.log(`  - ${cls.name} (School: ${cls.school?.name})`);
            });
        } else {
            console.log('✅ PASSED: No archived classes found in teacher view');
        }
        
        // Display all classes for verification
        console.log('\nAll classes returned:');
        classes.forEach(cls => {
            console.log(`  - ${cls.name} (School: ${cls.school?.name}, Archived: ${cls.isArchived || false})`);
        });
          } catch (error) {
        console.error('Test failed:');
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error message:', error.message);
        }
        console.error('Full error:', error);
    }
}

testArchivedClassesFilter();
