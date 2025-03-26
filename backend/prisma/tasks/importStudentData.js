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
function createOrGetStudent(name, tokenNumber, index) {
    return __awaiter(this, void 0, void 0, function* () {
        const username = name.toLowerCase().replace(/\s+/g, '_') + '_' + index;
        const existingStudent = yield prisma.user.findFirst({
            where: {
                OR: [
                    { tokenNumber },
                    { username }
                ]
            }
        });
        if (existingStudent) {
            return existingStudent;
        }
        const hashedPassword = yield hashPassword('saarthi@123');
        return yield prisma.user.create({
            data: {
                name: name,
                username,
                tokenNumber,
                password: hashedPassword,
                role: client_1.UserRole.STUDENT
            }
        });
    });
}
function getSchool(name) {
    return __awaiter(this, void 0, void 0, function* () {
        const school = yield prisma.school.findFirst({
            where: { name }
        });
        if (!school) {
            throw new Error(`School not found: ${name}`);
        }
        return school;
    });
}
function getClass(name, schoolId) {
    return __awaiter(this, void 0, void 0, function* () {
        const classEntity = yield prisma.class.findFirst({
            where: {
                name,
                schoolId
            }
        });
        if (!classEntity) {
            throw new Error(`Class not found: ${name} in school ${schoolId}`);
        }
        return classEntity;
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
        const studentData = jsonData.map((row) => {
            if (!row.Token_no || !row.Student_name || !row.School_Name || !row.Class) {
                throw new Error(`Invalid row data: ${JSON.stringify(row)}`);
            }
            return {
                Token_no: row.Token_no.toString().trim(),
                Student_name: row.Student_name.toString().trim(),
                School_Name: row.School_Name.toString().trim(),
                Class: row.Class.toString().trim()
            };
        });
        return studentData;
    }
    catch (error) {
        console.error('Error reading Excel file:', error);
        throw error;
    }
}
function processStudentData(data) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const batchSize = 15;
            console.log(`Processing ${data.length} student records in batches of ${batchSize}...`);
            // Process students in batches
            for (let i = 0; i < data.length; i += batchSize) {
                const batch = data.slice(i, i + batchSize);
                console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(data.length / batchSize)}`);
                yield Promise.all(batch.map((row, index) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        const batchIndex = i + index;
                        console.log(`\nStarting to process student: ${row.Student_name}`);
                        // Create or get student
                        const student = yield createOrGetStudent(row.Student_name, row.Token_no, batchIndex);
                        console.log(`Student processed: ${student.username} (Token: ${student.tokenNumber})`);
                        // Get school
                        const school = yield getSchool(row.School_Name);
                        console.log(`Found school: ${school.name} for student ${student.username}`);
                        // Get class
                        const classEntity = yield getClass(row.Class, school.id);
                        console.log(`Found class: ${classEntity.name} for student ${student.username}`);
                        // Create student-school relationship if it doesn't exist
                        yield prisma.studentSchool.upsert({
                            where: {
                                studentId_schoolId: {
                                    studentId: student.id,
                                    schoolId: school.id
                                }
                            },
                            create: {
                                studentId: student.id,
                                schoolId: school.id
                            },
                            update: {}
                        });
                        console.log(`Created/Updated student-school relationship for ${student.username}`);
                        // Create student-class relationship if it doesn't exist
                        yield prisma.studentClass.upsert({
                            where: {
                                studentId_classId: {
                                    studentId: student.id,
                                    classId: classEntity.id
                                }
                            },
                            create: {
                                studentId: student.id,
                                classId: classEntity.id
                            },
                            update: {}
                        });
                        console.log(`Created/Updated student-class relationship for ${student.username}`);
                        console.log(`\nCompleted processing student: ${student.username}`);
                    }
                    catch (error) {
                        console.error(`Error processing student ${row.Student_name}:`, error);
                        throw error;
                    }
                })));
                // Add a small delay between batches to allow connections to be released
                yield new Promise(resolve => setTimeout(resolve, 1000));
            }
            console.log('\nAll student data import completed successfully');
        }
        catch (error) {
            console.error('Error in batch processing of student data:', error);
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
const studentData = readExcelFile(excelFilePath);
processStudentData(studentData)
    .catch(console.error)
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
