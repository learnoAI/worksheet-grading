'use client';

import { UserManagementModal, USER_MANAGEMENT_CONFIGS } from './UserManagementModal';

interface TeacherManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    className: string;
    schoolId: string;
    onTeachersUpdated: () => void;
}

export function TeacherManagementModal({ 
    isOpen, 
    onClose, 
    classId, 
    className, 
    schoolId,
    onTeachersUpdated 
}: TeacherManagementModalProps) {
    return (
        <UserManagementModal
            isOpen={isOpen}
            onClose={onClose}
            classId={classId}
            className={className}
            schoolId={schoolId}
            onUsersUpdated={onTeachersUpdated}
            config={USER_MANAGEMENT_CONFIGS.teacher}
        />
    );
}
