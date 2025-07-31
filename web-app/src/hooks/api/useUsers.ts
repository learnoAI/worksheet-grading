import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { User } from '@/lib/api/types';
import { userAPI } from '@/lib/api';

export function useUsers(initialFilters?: {
  role?: string;
  isArchived?: boolean;
  page?: number;
  limit?: number;
  search?: string;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [filters, setFilters] = useState(initialFilters || {});

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await userAPI.getUsersWithDetails(filters);
      setUsers(response.users);
      setPagination(response.pagination);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch users';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const createUser = useCallback(async (userData: {
    name: string;
    username: string;
    password: string;
    role: string;
    tokenNumber?: string;
    classId?: string;
    schoolId?: string;
  }) => {
    try {
      const newUser = await userAPI.createUser(userData);
      await fetchUsers();
      toast.success('User created successfully');
      return newUser;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create user';
      toast.error(errorMessage);
      throw err;
    }
  }, [fetchUsers]);

  const updateUser = useCallback(async (id: string, updates: {
    name?: string;
    username?: string;
    password?: string;
    role?: string;
    tokenNumber?: string;
    classId?: string;
    schoolId?: string;
  }) => {
    try {
      const updatedUser = await userAPI.updateUser(id, updates);
      setUsers(prev => prev.map(user => user.id === id ? updatedUser : user));
      toast.success('User updated successfully');
      return updatedUser;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update user';
      toast.error(errorMessage);
      throw err;
    }
  }, []);

  const deleteUser = useCallback(async (id: string) => {
    try {
      await userAPI.deleteUser(id);
      await fetchUsers();
      toast.success('User deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete user';
      toast.error(errorMessage);
      throw err;
    }
  }, [fetchUsers]);

  const archiveUser = useCallback(async (id: string) => {
    try {
      await userAPI.archiveStudent(id);
      await fetchUsers();
      toast.success('User archived successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to archive user';
      toast.error(errorMessage);
      throw err;
    }
  }, [fetchUsers]);

  const unarchiveUser = useCallback(async (id: string) => {
    try {
      await userAPI.unarchiveStudent(id);
      await fetchUsers();
      toast.success('User unarchived successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to unarchive user';
      toast.error(errorMessage);
      throw err;
    }
  }, [fetchUsers]);

  const updateFilters = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const refetch = useCallback(() => {
    fetchUsers();
  }, [fetchUsers]);

  return {
    users,
    loading,
    error,
    pagination,
    filters,
    createUser,
    updateUser,
    deleteUser,
    archiveUser,
    unarchiveUser,
    updateFilters,
    refetch,
  };
}
