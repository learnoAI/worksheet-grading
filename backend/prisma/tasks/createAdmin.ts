import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from 'bcrypt';

async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}
async function createAdmin() {
    const prisma = new PrismaClient();

    const admin = await prisma.user.create({
        data: {
            name: 'Super Admin',
            username: 'superadmin',
            password: await hashPassword('admin@saarthi'),
            role: UserRole.SUPERADMIN
        }
    });

    console.log('Admin created:', admin);
}

createAdmin();