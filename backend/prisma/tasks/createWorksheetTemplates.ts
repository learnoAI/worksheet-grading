import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();


async function createWorksheetTemplates() {


    for (let i = 0; i < 2430; i++) {
        const template = await prisma.worksheetTemplate.upsert({
            where: {
                worksheetNumber: i + 1
            },
            update: {},
            create: {
                worksheetNumber: i + 1
            }
        });
    }
}

createWorksheetTemplates().catch(console.error).finally(async () => {
    await prisma.$disconnect();
});