'use client';

import React from 'react';
import { UserRole, User } from '@/src/types';
import { UserForm } from '../forms/UserFormNew';
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogHeader, 
    DialogTitle 
} from '@/components/ui/dialog';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  mode?: 'create' | 'edit';
  allowedRoles?: UserRole[];
  defaultSchool?: string;
  defaultClass?: string;
  initialData?: Partial<User & { classId?: string }>;
  title?: string;
  description?: string;
}

export function UserModal({
  isOpen,
  onClose,
  onSuccess,
  mode = 'create',
  allowedRoles = [UserRole.TEACHER, UserRole.STUDENT],
  defaultSchool,
  defaultClass,
  initialData,
  title,
  description
}: UserModalProps) {
  const modalTitle = title || (mode === 'create' ? 'Create New User' : 'Edit User');
  const modalDescription = description || (mode === 'create' 
    ? 'Add a new user to the system' 
    : 'Update user information and settings');

  const handleSuccess = () => {
    onSuccess?.();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{modalTitle}</DialogTitle>
          <DialogDescription>
            {modalDescription}
          </DialogDescription>
        </DialogHeader>
        
        <UserForm
          onClose={onClose}
          onSuccess={handleSuccess}
          onCancel={onClose}
          allowedRoles={allowedRoles}
          defaultSchool={defaultSchool}
          defaultClass={defaultClass}
          mode={mode}
          initialData={initialData}
        />
      </DialogContent>
    </Dialog>
  );
}
