import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting seed...');

    // Clear existing data
    await prisma.notification.deleteMany();
    await prisma.worksheet.deleteMany();
    await prisma.studentClass.deleteMany();
    await prisma.teacherClass.deleteMany();
    await prisma.adminSchool.deleteMany();
    await prisma.class.deleteMany();
    await prisma.school.deleteMany();
    await prisma.cluster.deleteMany();
    await prisma.user.deleteMany();

    console.log('Cleared existing data');

    // Create users
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create superadmin
    const superadmin = await prisma.user.create({
        data: {
            username: 'superadmin',
            password: hashedPassword,
            role: UserRole.SUPERADMIN
        }
    });
    console.log('Created superadmin:', superadmin.id);

    // Create admin
    const admin = await prisma.user.create({
        data: {
            username: 'admin',
            password: hashedPassword,
            role: UserRole.ADMIN
        }
    });
    console.log('Created admin:', admin.id);

    // Create teachers
    const teacher1 = await prisma.user.create({
        data: {
            username: 'teacher1',
            password: hashedPassword,
            role: UserRole.TEACHER
        }
    });
    console.log('Created teacher1:', teacher1.id);

    const teacher2 = await prisma.user.create({
        data: {
            username: 'teacher2',
            password: hashedPassword,
            role: UserRole.TEACHER
        }
    });
    console.log('Created teacher2:', teacher2.id);

    // Create students
    const student1 = await prisma.user.create({
        data: {
            username: 'student1',
            password: hashedPassword,
            role: UserRole.STUDENT
        }
    });
    console.log('Created student1:', student1.id);

    const student2 = await prisma.user.create({
        data: {
            username: 'student2',
            password: hashedPassword,
            role: UserRole.STUDENT
        }
    });
    console.log('Created student2:', student2.id);

    // Create cluster
    const cluster = await prisma.cluster.create({
        data: {
            name: 'North Region Cluster'
        }
    });
    console.log('Created cluster:', cluster.id);

    // Create school
    const school = await prisma.school.create({
        data: {
            name: 'Springfield Elementary',
            clusterId: cluster.id
        }
    });
    console.log('Created school:', school.id);

    // Link admin to school
    await prisma.adminSchool.create({
        data: {
            adminId: admin.id,
            schoolId: school.id
        }
    });
    console.log('Linked admin to school');

    // Create classes
    const class1 = await prisma.class.create({
        data: {
            name: 'Math 101',
            schoolId: school.id
        }
    });
    console.log('Created class1:', class1.id);

    const class2 = await prisma.class.create({
        data: {
            name: 'Science 101',
            schoolId: school.id
        }
    });
    console.log('Created class2:', class2.id);

    // Link teachers to classes
    await prisma.teacherClass.create({
        data: {
            teacherId: teacher1.id,
            classId: class1.id
        }
    });
    console.log('Linked teacher1 to class1');

    await prisma.teacherClass.create({
        data: {
            teacherId: teacher2.id,
            classId: class2.id
        }
    });
    console.log('Linked teacher2 to class2');

    // Link students to classes
    await prisma.studentClass.create({
        data: {
            studentId: student1.id,
            classId: class1.id
        }
    });
    console.log('Linked student1 to class1');

    await prisma.studentClass.create({
        data: {
            studentId: student1.id,
            classId: class2.id
        }
    });
    console.log('Linked student1 to class2');

    await prisma.studentClass.create({
        data: {
            studentId: student2.id,
            classId: class1.id
        }
    });
    console.log('Linked student2 to class1');

    console.log('Seed completed successfully!');
}

main()
    .catch((e) => {
        console.error('Error during seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    }); 