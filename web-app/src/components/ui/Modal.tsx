import { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  preventOutsideClick?: boolean;
}

interface ConfirmModalProps extends Omit<ModalProps, 'children' | 'footer'> {
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  variant?: 'default' | 'destructive';
  loading?: boolean;
}

interface FormModalProps extends Omit<ModalProps, 'footer'> {
  onSubmit?: () => void | Promise<void>;
  onCancel?: () => void;
  submitText?: string;
  cancelText?: string;
  loading?: boolean;
  disabled?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  preventOutsideClick = false,
}: ModalProps) {
  const sizeClasses = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
    full: 'sm:max-w-[90vw]',
  };

  return (
    <Dialog 
      open={isOpen} 
      onOpenChange={preventOutsideClick ? undefined : onClose}
    >
      <DialogContent className={sizeClasses[size]}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        {footer}
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  title,
  description,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  variant = 'default',
  loading = false,
}: ConfirmModalProps) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? 'Processing...' : confirmText}
          </Button>
        </DialogFooter>
      }
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </Modal>
  );
}

export function FormModal({
  isOpen,
  onClose,
  title,
  description,
  children,
  onSubmit,
  onCancel,
  submitText = 'Save',
  cancelText = 'Cancel',
  loading = false,
  disabled = false,
  size = 'md',
}: FormModalProps) {
  const handleCancel = () => {
    onCancel?.() || onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={loading}
          >
            {cancelText}
          </Button>
          {onSubmit && (
            <Button
              onClick={onSubmit}
              disabled={loading || disabled}
            >
              {loading ? 'Saving...' : submitText}
            </Button>
          )}
        </DialogFooter>
      }
    >
      {children}
    </Modal>
  );
}
