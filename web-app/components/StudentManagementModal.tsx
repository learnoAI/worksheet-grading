'use client';

import { UserManagementModal, USER_MANAGEMENT_CONFIGS } from './UserManagementModal';

interface StudentManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    className: string;
    schoolId: string;
    onStudentsUpdated: () => void;
}

export function StudentManagementModal({ 
    isOpen, 
    onClose, 
    classId, 
    className, 
    schoolId,
    onStudentsUpdated 
}: StudentManagementModalProps) {
    return (
        <UserManagementModal
            isOpen={isOpen}
            onClose={onClose}
            classId={classId}
            className={className}
            schoolId={schoolId}
            onUsersUpdated={onStudentsUpdated}
            config={USER_MANAGEMENT_CONFIGS.student}
        />
    );
}
