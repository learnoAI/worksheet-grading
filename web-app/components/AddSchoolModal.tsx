'use client';

import { SchoolForm } from '@/src/components/forms/SchoolForm';

interface AddSchoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddSchoolModal({ isOpen, onClose, onSuccess }: AddSchoolModalProps) {
  return (
    <SchoolForm
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
