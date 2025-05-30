const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUsers() {
    try {
        console.log('Checking available users in database...');
        
        const users = await prisma.user.findMany({
            where: {
                role: 'TEACHER'
            },
            select: {
                id: true,
                username: true,
                name: true,
                role: true
            }
        });
        
        console.log('Available teacher users:');
        users.forEach(user => {
            console.log(`  - ${user.username} (${user.name})`);
        });
        
        if (users.length > 0) {
            const firstTeacher = users[0];
            console.log(`\nTesting with teacher: ${firstTeacher.username}`);
            
            // Get classes for this teacher
            const classes = await prisma.teacherClass.findMany({
                where: {
                    teacherId: firstTeacher.id
                },
                include: {
                    class: {
                        include: {
                            school: true
                        }
                    }
                }
            });
            
            console.log(`\nClasses for ${firstTeacher.username}:`);
            classes.forEach(tc => {
                console.log(`  - ${tc.class.name} (School: ${tc.class.school.name}, Archived: ${tc.class.isArchived})`);
            });
            
            // Check if there are any archived classes
            const archivedClasses = classes.filter(tc => tc.class.isArchived);
            if (archivedClasses.length > 0) {
                console.log(`\n❌ Found ${archivedClasses.length} archived classes! These should be filtered out in the API.`);
            } else {
                console.log('\n✅ No archived classes found for this teacher.');
            }
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkUsers();
