'use client';

import { SchoolArchiveDialog } from '@/src/components/dialogs/SchoolArchiveDialog';
import { School } from '@/lib/api/types';

interface ArchiveSchoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  school: School | null;
  action: 'archive' | 'unarchive';
}

export function ArchiveSchoolModal({ isOpen, onClose, onSuccess, school, action }: ArchiveSchoolModalProps) {
  return (
    <SchoolArchiveDialog
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={onSuccess}
      school={school}
      action={action}
    />
  );
}