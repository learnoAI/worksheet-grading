'use client';

import React, { useState } from 'react';
import { UserRole, User } from '@/src/types';
import { useLoadingState } from '@/src/hooks/useLoadingState';
import { userAPI } from '@/lib/api/user';
import { analyticsAPI } from '@/lib/api/analytics';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { LoadingState } from '@/src/components/ui/loading';

interface UserFormProps {
  onClose?: () => void;
  onSuccess?: () => void;
  onCancel?: () => void;
  allowedRoles?: UserRole[];
  defaultSchool?: string;
  defaultClass?: string;
  mode?: 'create' | 'edit';
  initialData?: Partial<User & { classId?: string }>;
}

interface School {
  id: string;
  name: string;
}

interface Class {
  id: string;
  name: string;
  schoolId: string;
}

export function UserForm({ 
  onClose, 
  onSuccess, 
  onCancel,
  allowedRoles = [UserRole.TEACHER, UserRole.STUDENT],
  defaultSchool,
  defaultClass,
  mode = 'create',
  initialData
}: UserFormProps) {
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    username: initialData?.username || '',
    password: '',
    tokenNumber: initialData?.tokenNumber || '',
    role: initialData?.role || allowedRoles[0],
    schoolId: initialData?.schoolId || defaultSchool || '',
    classId: initialData?.classId || defaultClass || '',
  });

  const [schools, setSchools] = useState<School[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  
  const { isLoading: submitLoading, setLoading: setSubmitLoading } = useLoadingState();

  React.useEffect(() => {
    loadInitialData();
  }, []);

  React.useEffect(() => {
    if (formData.schoolId) {
      loadClasses();
    } else {
      setClasses([]);
      setFormData(prev => ({ ...prev, classId: '' }));
    }
  }, [formData.schoolId]);

  const loadInitialData = async () => {
    try {
      setLoadingData(true);
      const schoolsData = await analyticsAPI.getAllSchools();
      setSchools(schoolsData);
      
      if (defaultSchool || formData.schoolId) {
        const classesData = await analyticsAPI.getClassesBySchool(defaultSchool || formData.schoolId);
        setClasses(classesData);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoadingData(false);
    }
  };

  const loadClasses = async () => {
    try {
      const classesData = await analyticsAPI.getClassesBySchool(formData.schoolId);
      setClasses(classesData);
    } catch (error) {
      console.error('Error loading classes:', error);
      toast.error('Failed to load classes');
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    if (!formData.name || !formData.username) {
      toast.error('Name and username are required');
      return false;
    }

    if (mode === 'create' && !formData.password) {
      toast.error('Password is required');
      return false;
    }

    if (formData.password && formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return false;
    }

    if (formData.role === UserRole.STUDENT) {
      if (!formData.tokenNumber) {
        toast.error('Token number is required for students');
        return false;
      }
      if (!formData.classId) {
        toast.error('Class selection is required for students');
        return false;
      }
    }

    if (formData.role === UserRole.TEACHER && !formData.classId) {
      toast.error('Class selection is required for teachers');
      return false;
    }

    return true;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    try {
      setSubmitLoading(true);

      if (mode === 'create') {
        // For create mode, password is required
        const createData = {
          name: formData.name,
          username: formData.username,
          password: formData.password,
          role: formData.role,
          ...(formData.role === UserRole.STUDENT && formData.tokenNumber && { tokenNumber: formData.tokenNumber }),
          ...(formData.classId && (formData.role === UserRole.STUDENT || formData.role === UserRole.TEACHER) && { classId: formData.classId }),
          ...(formData.role === UserRole.ADMIN && formData.schoolId && { schoolId: formData.schoolId })
        };
        
        await userAPI.createUser(createData);
        toast.success(`${formData.role.toLowerCase()} created successfully`);
      } else {
        // For update mode, password is optional
        const updateData: any = {
          name: formData.name,
          username: formData.username,
          role: formData.role,
          ...(formData.password && { password: formData.password }),
          ...(formData.role === UserRole.STUDENT && formData.tokenNumber && { tokenNumber: formData.tokenNumber }),
          ...(formData.classId && (formData.role === UserRole.STUDENT || formData.role === UserRole.TEACHER) && { classId: formData.classId }),
          ...(formData.role === UserRole.ADMIN && formData.schoolId && { schoolId: formData.schoolId })
        };
        
        await userAPI.updateUser(initialData?.id!, updateData);
        toast.success(`${formData.role.toLowerCase()} updated successfully`);
      }

      onSuccess?.();
    } catch (error: unknown) {
      console.error('Error with user:', error);
      toast.error(error instanceof Error ? error.message : `Failed to ${mode} user`);
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleCancel = () => {
    onCancel?.();
    onClose?.();
  };

  if (loadingData) {
    return (
      <Card className="w-full max-w-2xl">
        <CardContent className="p-6">
          <div className="flex justify-center items-center h-32">
            <LoadingState message="Loading data..." />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <form onSubmit={onSubmit}>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>
                {mode === 'create' ? 'Create New User' : 'Edit User'}
              </CardTitle>
              <CardDescription>
                {mode === 'create' 
                  ? 'Add a new student or teacher to the system'
                  : 'Update user information'
                }
              </CardDescription>
            </div>
            {onClose && (
              <Button 
                type="button" 
                variant="ghost" 
                size="sm" 
                onClick={onClose}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Enter full name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={formData.username}
              onChange={(e) => updateField('username', e.target.value)}
              placeholder="Enter username"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">
              Password {mode === 'edit' && '(leave blank to keep current)'}
            </Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => updateField('password', e.target.value)}
              placeholder="Enter password (min 6 characters)"
              required={mode === 'create'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">User Role</Label>
            <Select value={formData.role} onValueChange={(value) => updateField('role', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {allowedRoles.map(role => (
                  <SelectItem key={role} value={role}>
                    {role === UserRole.TEACHER ? 'Teacher' : 
                     role === UserRole.STUDENT ? 'Student' : 'Admin'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formData.role === UserRole.STUDENT && (
            <div className="space-y-2">
              <Label htmlFor="tokenNumber">Token Number</Label>
              <Input
                id="tokenNumber"
                value={formData.tokenNumber}
                onChange={(e) => updateField('tokenNumber', e.target.value)}
                placeholder="Enter token number"
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="school">School</Label>
            <Select value={formData.schoolId} onValueChange={(value) => updateField('schoolId', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select school" />
              </SelectTrigger>
              <SelectContent>
                {schools.map(school => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formData.schoolId && (
            <div className="space-y-2">
              <Label htmlFor="class">Class</Label>
              <Select 
                value={formData.classId} 
                onValueChange={(value) => updateField('classId', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map(cls => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-gray-500">
                {formData.role === UserRole.STUDENT 
                  ? 'Student will be assigned to this class' 
                  : 'Teacher will be assigned to this class'
                }
              </p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitLoading}>
            {submitLoading 
              ? (mode === 'create' ? 'Creating...' : 'Updating...') 
              : (mode === 'create' ? 'Create User' : 'Update User')
            }
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
