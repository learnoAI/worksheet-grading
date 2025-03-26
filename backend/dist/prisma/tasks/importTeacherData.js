"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const XLSX = __importStar(require("xlsx"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma = new client_1.PrismaClient();
function hashPassword(password) {
    return __awaiter(this, void 0, void 0, function* () {
        return bcrypt_1.default.hash(password, 10);
    });
}
function createOrGetTeacher(name) {
    return __awaiter(this, void 0, void 0, function* () {
        const username = name.toLowerCase().replace(/\s+/g, '_');
        const existingTeacher = yield prisma.user.findUnique({
            where: { username }
        });
        if (existingTeacher) {
            return existingTeacher;
        }
        return yield prisma.user.create({
            data: {
                name,
                username,
                password: yield hashPassword('saarthi@123'),
                role: client_1.UserRole.TEACHER
            }
        });
    });
}
function createOrGetSchool(name) {
    return __awaiter(this, void 0, void 0, function* () {
        const existingSchool = yield prisma.school.findFirst({
            where: { name }
        });
        if (existingSchool) {
            return existingSchool;
        }
        return yield prisma.school.create({
            data: { name }
        });
    });
}
function createOrGetClass(name, schoolId) {
    return __awaiter(this, void 0, void 0, function* () {
        const existingClass = yield prisma.class.findFirst({
            where: {
                name,
                schoolId
            }
        });
        if (existingClass) {
            return existingClass;
        }
        return yield prisma.class.create({
            data: {
                name,
                schoolId
            }
        });
    });
}
function readExcelFile(filePath) {
    try {
        // Read the Excel file
        const workbook = XLSX.readFile(filePath);
        // Get the first worksheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        // Validate and transform the data
        const teacherData = jsonData.map((row) => {
            if (!row.SR_Name || !row.School || !row.Class) {
                throw new Error(`Invalid row data: ${JSON.stringify(row)}`);
            }
            return {
                SR_Name: row.SR_Name.toString().trim(),
                School: row.School.toString().trim(),
                Class: row.Class.toString().trim()
            };
        });
        return teacherData;
    }
    catch (error) {
        console.error('Error reading Excel file:', error);
        throw error;
    }
}
function processTeacherData(data) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log(`Processing ${data.length} records...`);
            for (const row of data) {
                console.log(`Processing teacher: ${row.SR_Name}`);
                // Create or get teacher
                const teacher = yield createOrGetTeacher(row.SR_Name);
                console.log(`Teacher processed: ${teacher.username}`);
                // Create or get school
                const school = yield createOrGetSchool(row.School);
                console.log(`School processed: ${school.name}`);
                // Create or get class
                const classEntity = yield createOrGetClass(row.Class, school.id);
                console.log(`Class processed: ${classEntity.name}`);
                // Create teacher-school relationship if it doesn't exist
                yield prisma.teacherSchool.upsert({
                    where: {
                        teacherId_schoolId: {
                            teacherId: teacher.id,
                            schoolId: school.id
                        }
                    },
                    create: {
                        teacherId: teacher.id,
                        schoolId: school.id
                    },
                    update: {}
                });
                // Create teacher-class relationship if it doesn't exist
                yield prisma.teacherClass.upsert({
                    where: {
                        teacherId_classId: {
                            teacherId: teacher.id,
                            classId: classEntity.id
                        }
                    },
                    create: {
                        teacherId: teacher.id,
                        classId: classEntity.id
                    },
                    update: {}
                });
                console.log(`Completed processing for ${row.SR_Name}\n`);
            }
            console.log('Data import completed successfully');
        }
        catch (error) {
            console.error('Error processing teacher data:', error);
            throw error;
        }
    });
}
// Get the Excel file path from command line arguments
const excelFilePath = process.argv[2];
if (!excelFilePath) {
    console.error('Please provide the Excel file path as a command line argument');
    process.exit(1);
}
// Read and process the Excel file
const teacherData = readExcelFile(excelFilePath);
processTeacherData(teacherData)
    .catch(console.error)
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
