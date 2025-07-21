'use client';

import { useState } from 'react';
import { schoolAPI } from '@/lib/api';
import { School } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Building2, Archive, ArchiveRestore } from 'lucide-react';

interface ArchiveSchoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  school: School | null;
  action: 'archive' | 'unarchive';
}

export function ArchiveSchoolModal({ isOpen, onClose, onSuccess, school, action }: ArchiveSchoolModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!school) {
      toast.error('No school selected');
      return;
    }

    setIsSubmitting(true);

    try {
      if (action === 'archive') {
        await schoolAPI.archiveSchool(school.id);
        toast.success('School archived successfully');
      } else {
        await schoolAPI.unarchiveSchool(school.id);
        toast.success('School unarchived successfully');
      }
      
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error(`Error ${action}ing school:`, error);
      const errorMessage = error.message || `Failed to ${action} school`;
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  const isArchiving = action === 'archive';
  const actionText = isArchiving ? 'Archive' : 'Unarchive';
  const actionDescription = isArchiving 
    ? 'This will hide the school from the main list but preserve all data. You can restore it later.'
    : 'This will restore the school to the main list and make it visible again.';

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            {isArchiving ? (
              <Archive className="h-5 w-5 text-orange-500" />
            ) : (
              <ArchiveRestore className="h-5 w-5 text-green-500" />
            )}
            <span>{actionText} School</span>
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to {action} <strong>{school?.name}</strong>?
            <br />
            <br />
            {actionDescription}
          </DialogDescription>
        </DialogHeader>
        
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button 
            type="button" 
            variant={isArchiving ? "default" : "default"}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? `${actionText}ing...` : actionText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
