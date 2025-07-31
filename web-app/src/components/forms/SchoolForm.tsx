import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormModal } from '@/src/components/ui/Modal';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAsyncOperation } from '@/src/hooks/useLoadingState';
import { schoolAPI } from '@/lib/api';
import { toast } from 'sonner';

const schoolFormSchema = z.object({
  name: z.string().min(1, 'School name is required').max(200, 'School name must be less than 200 characters'),
});

type SchoolFormData = z.infer<typeof schoolFormSchema>;

interface SchoolFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  school?: { id: string; name: string } | null;
}

export function SchoolForm({ isOpen, onClose, onSuccess, school }: SchoolFormProps) {
  const isEditing = !!school;
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<SchoolFormData>({
    resolver: zodResolver(schoolFormSchema),
    defaultValues: {
      name: school?.name || '',
    },
  });

  const { execute: submitSchool, isLoading } = useAsyncOperation(
    async (data: SchoolFormData) => {
      if (isEditing && school) {
        await schoolAPI.updateSchool(school.id, data);
        toast.success('School updated successfully');
      } else {
        await schoolAPI.createSchool(data);
        toast.success('School created successfully');
      }
      onSuccess();
      onClose();
      reset();
    }
  );

  const handleFormSubmit = (data: SchoolFormData) => {
    if (isEditing && school && data.name.trim() === school.name) {
      toast.info('No changes to save');
      return;
    }
    submitSchool(data);
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
      reset();
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? 'Edit School' : 'Add New School'}
      description={isEditing ? 'Update school information.' : 'Create a new school in the system.'}
      onSubmit={handleSubmit(handleFormSubmit)}
      submitText={isEditing ? 'Update School' : 'Create School'}
      loading={isLoading}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">School Name *</Label>
          <Input
            id="name"
            placeholder="Enter school name"
            {...register('name')}
            disabled={isLoading}
          />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>
      </div>
    </FormModal>
  );
}
