'use client';

import { UserForm } from '@/src/components/forms/UserFormNew';
import { UserRole } from '@/src/types';

interface CreateUserFormProps {
    onClose: () => void;
    onSuccess: () => void;
    allowedRoles?: UserRole[];
    defaultSchool?: string;
    defaultClass?: string;
}

export function CreateUserForm({ 
    onClose, 
    onSuccess, 
    allowedRoles = [UserRole.TEACHER, UserRole.STUDENT],
    defaultSchool,
    defaultClass
}: CreateUserFormProps) {
    return (
        <UserForm
            mode="create"
            onClose={onClose}
            onSuccess={onSuccess}
            allowedRoles={allowedRoles}
            defaultSchool={defaultSchool}
            defaultClass={defaultClass}
        />
    );
}
