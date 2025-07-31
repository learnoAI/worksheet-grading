import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Class, User } from '@/lib/api/types';
import { classAPI } from '@/lib/api';

export function useClasses(initialFilters?: {
  schoolId?: string;
  isArchived?: boolean;
  page?: number;
  limit?: number;
  search?: string;
}) {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(initialFilters || {});

  const fetchClasses = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const allClasses = await classAPI.getAllClasses(true);

      let filteredClasses = allClasses;
      
      if (filters.search) {
        filteredClasses = allClasses.filter(cls =>
          cls.name.toLowerCase().includes(filters.search!.toLowerCase())
        );
      }

      if (filters.isArchived !== undefined) {
        filteredClasses = filteredClasses.filter(cls => 
          cls.isArchived === filters.isArchived
        );
      }

      if (filters.schoolId) {
        filteredClasses = filteredClasses.filter(cls => 
          cls.schoolId === filters.schoolId
        );
      }

      setClasses(filteredClasses);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch classes';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const archiveClass = useCallback(async (id: string) => {
    try {
      await classAPI.archiveClass(id);
      await fetchClasses();
      toast.success('Class archived successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to archive class';
      toast.error(errorMessage);
      throw err;
    }
  }, [fetchClasses]);

  const unarchiveClass = useCallback(async (id: string) => {
    try {
      await classAPI.unarchiveClass(id);
      await fetchClasses();
      toast.success('Class unarchived successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to unarchive class';
      toast.error(errorMessage);
      throw err;
    }
  }, [fetchClasses]);

  const updateFilters = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const refetch = useCallback(() => {
    fetchClasses();
  }, [fetchClasses]);

  return {
    classes,
    loading,
    error,
    filters,
    archiveClass,
    unarchiveClass,
    updateFilters,
    refetch,
  };
}

export function useClassMembers(classId: string) {
  const [students, setStudents] = useState<User[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!classId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const [studentsData, teachersData] = await Promise.all([
        classAPI.getClassStudentsWithDetails(classId),
        classAPI.getClassTeachers(classId),
      ]);
      
      setStudents(studentsData);
      setTeachers(teachersData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch class members';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const addStudent = useCallback(async (studentId: string) => {
    try {
      await classAPI.addStudentToClass(classId, studentId);
      await fetchMembers();
      toast.success('Student added to class successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add student to class';
      toast.error(errorMessage);
      throw err;
    }
  }, [classId, fetchMembers]);

  const removeStudent = useCallback(async (studentId: string) => {
    try {
      await classAPI.removeStudentFromClass(classId, studentId);
      await fetchMembers();
      toast.success('Student removed from class successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove student from class';
      toast.error(errorMessage);
      throw err;
    }
  }, [classId, fetchMembers]);

  const addTeacher = useCallback(async (teacherId: string) => {
    try {
      await classAPI.addTeacherToClass(classId, teacherId);
      await fetchMembers();
      toast.success('Teacher added to class successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add teacher to class';
      toast.error(errorMessage);
      throw err;
    }
  }, [classId, fetchMembers]);

  const removeTeacher = useCallback(async (teacherId: string) => {
    try {
      await classAPI.removeTeacherFromClass(classId, teacherId);
      await fetchMembers();
      toast.success('Teacher removed from class successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove teacher from class';
      toast.error(errorMessage);
      throw err;
    }
  }, [classId, fetchMembers]);

  const refetch = useCallback(() => {
    fetchMembers();
  }, [fetchMembers]);

  return {
    students,
    teachers,
    loading,
    error,
    addStudent,
    removeStudent,
    addTeacher,
    removeTeacher,
    refetch,
  };
}
