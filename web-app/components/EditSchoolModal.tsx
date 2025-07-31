'use client';

import { SchoolForm } from '@/src/components/forms/SchoolForm';
import { School } from '@/lib/api/types';

interface EditSchoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  school: School | null;
}

export function EditSchoolModal({ isOpen, onClose, onSuccess, school }: EditSchoolModalProps) {
  return (
    <SchoolForm
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={onSuccess}
      school={school}
    />
  );
}