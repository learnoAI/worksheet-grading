import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const deleteAllWorksheets = async () => {
    await prisma.worksheet.deleteMany().catch(error => {
        console.error('Error deleting worksheets:', error);
    }).finally(() => {
        console.log('Worksheets deleted successfully');
    });

}

deleteAllWorksheets();