/*
  Warnings:

  - A unique constraint covering the columns `[tokenNumber]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "studentSchoolId" TEXT,
ADD COLUMN     "tokenNumber" TEXT;

-- CreateTable
CREATE TABLE "TeacherSchool" (
    "teacherId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherSchool_pkey" PRIMARY KEY ("teacherId","schoolId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tokenNumber_key" ON "User"("tokenNumber");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_studentSchoolId_fkey" FOREIGN KEY ("studentSchoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSchool" ADD CONSTRAINT "TeacherSchool_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSchool" ADD CONSTRAINT "TeacherSchool_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
