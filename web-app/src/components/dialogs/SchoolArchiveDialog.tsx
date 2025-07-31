import { ConfirmModal } from '@/src/components/ui/Modal';
import { useAsyncOperation } from '@/src/hooks/useLoadingState';
import { schoolAPI } from '@/lib/api';
import { toast } from 'sonner';

interface SchoolArchiveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  school: { id: string; name: string; isArchived?: boolean } | null;
  action: 'archive' | 'unarchive';
}

export function SchoolArchiveDialog({
  isOpen,
  onClose,
  onSuccess,
  school,
  action,
}: SchoolArchiveDialogProps) {
  const isArchiving = action === 'archive';
  
  const { execute: executeAction, isLoading } = useAsyncOperation(
    async () => {
      if (!school) return;
      
      if (isArchiving) {
        await schoolAPI.archiveSchool(school.id);
        toast.success('School archived successfully');
      } else {
        await schoolAPI.unarchiveSchool(school.id);
        toast.success('School restored successfully');
      }
      
      onSuccess();
      onClose();
    }
  );

  const handleAction = async () => {
    await executeAction();
  };

  const actionText = isArchiving ? 'Archive' : 'Restore';
  const message = isArchiving
    ? `This will hide "${school?.name}" from the main list but preserve all data. You can restore it later.`
    : `This will restore "${school?.name}" to the main list and make it visible again.`;

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${actionText} School`}
      message={message}
      confirmText={actionText}
      variant={isArchiving ? 'destructive' : 'default'}
      onConfirm={handleAction}
      loading={isLoading}
    />
  );
}
