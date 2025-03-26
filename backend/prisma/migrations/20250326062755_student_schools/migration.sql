/*
  Warnings:

  - You are about to drop the column `studentSchoolId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_studentSchoolId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "studentSchoolId";

-- CreateTable
CREATE TABLE "StudentSchool" (
    "studentId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentSchool_pkey" PRIMARY KEY ("studentId","schoolId")
);

-- AddForeignKey
ALTER TABLE "StudentSchool" ADD CONSTRAINT "StudentSchool_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSchool" ADD CONSTRAINT "StudentSchool_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
