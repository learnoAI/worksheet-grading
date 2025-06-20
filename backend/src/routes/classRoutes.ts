import express from 'express';
import {
    getAllClasses,
    getArchivedClasses,
    archiveClass,
    unarchiveClass,
    getClassById,
    addTeacherToClass,
    removeTeacherFromClass,
    getClassTeachers,
    getAvailableTeachers,
    getClassStudents,
    addStudentToClass,
    removeStudentFromClass,
    getAvailableStudents
} from '../controllers/classController';
import { UserRole } from '@prisma/client';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

// Protect all class management routes for SuperAdmin only
router.use(auth);
router.use(authorizeRoles([UserRole.SUPERADMIN]));

// Get all classes (with option to include archived)
router.get('/', asHandler(getAllClasses));

// Get archived classes only
router.get('/archived', asHandler(getArchivedClasses));

// Get available teachers for a class
router.get('/teachers/available/:classId', asHandler(getAvailableTeachers));

// Get available students for a class
router.get('/students/available/:classId', asHandler(getAvailableStudents));

// Get class details by ID
router.get('/:id', asHandler(getClassById));

// Get teachers for a specific class
router.get('/:id/teachers', asHandler(getClassTeachers));

// Get students for a specific class
router.get('/:id/students', asHandler(getClassStudents));

// Add teacher to class
router.post('/:id/teachers/:teacherId', asHandler(addTeacherToClass));

// Add student to class
router.post('/:id/students/:studentId', asHandler(addStudentToClass));

// Remove teacher from class
router.delete('/:id/teachers/:teacherId', asHandler(removeTeacherFromClass));

// Remove student from class
router.delete('/:id/students/:studentId', asHandler(removeStudentFromClass));

// Archive a class
router.post('/:id/archive', asHandler(archiveClass));

// Unarchive a class
router.post('/:id/unarchive', asHandler(unarchiveClass));

export default router;
