'use client';

import { useState, useEffect } from 'react';
import { schoolAPI } from '@/lib/api';
import { School } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';

interface EditSchoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  school: School | null;
}

export function EditSchoolModal({ isOpen, onClose, onSuccess, school }: EditSchoolModalProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (school) {
      setName(school.name);
    } else {
      setName('');
    }
  }, [school]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!school) {
      toast.error('No school selected');
      return;
    }

    if (!name.trim()) {
      toast.error('School name is required');
      return;
    }

    if (name.trim() === school.name) {
      toast.info('No changes made');
      onClose();
      return;
    }

    setIsSubmitting(true);

    try {
      await schoolAPI.updateSchool(school.id, { name: name.trim() });
      toast.success('School updated successfully');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error updating school:', error);
      const errorMessage = error.message || 'Failed to update school';
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setName(school?.name || '');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Building2 className="h-5 w-5" />
            <span>Edit School</span>
          </DialogTitle>
          <DialogDescription>
            Update the school information. Make your changes below.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                School Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter school name"
                className="col-span-3"
                disabled={isSubmitting}
                required
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Updating...' : 'Update School'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
