import { ReactNode, HTMLInputTypeAttribute } from 'react';
import { UseFormRegisterReturn, FieldError } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/src/utils';

interface FieldWrapperProps {
  label: string;
  required?: boolean;
  error?: FieldError;
  children: ReactNode;
  className?: string;
}

interface FormFieldProps extends FieldWrapperProps {
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  disabled?: boolean;
  register: UseFormRegisterReturn;
}

interface TextareaFieldProps extends Omit<FormFieldProps, 'type'> {
  rows?: number;
}

interface SelectFieldProps extends Omit<FormFieldProps, 'type' | 'register'> {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

export function FieldWrapper({ 
  label, 
  required, 
  error, 
  children, 
  className 
}: FieldWrapperProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {error && (
        <p className="text-sm text-destructive">{error.message}</p>
      )}
    </div>
  );
}

export function FormField({
  label,
  required,
  error,
  type = 'text',
  placeholder,
  disabled,
  register,
  className,
}: FormFieldProps) {
  return (
    <FieldWrapper 
      label={label} 
      required={required} 
      error={error} 
      className={className}
    >
      <Input
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        {...register}
        className={error ? 'border-destructive' : ''}
      />
    </FieldWrapper>
  );
}

export function TextareaField({
  label,
  required,
  error,
  placeholder,
  disabled,
  register,
  rows = 3,
  className,
}: TextareaFieldProps) {
  return (
    <FieldWrapper 
      label={label} 
      required={required} 
      error={error} 
      className={className}
    >
      <Textarea
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        {...register}
        className={error ? 'border-destructive' : ''}
      />
    </FieldWrapper>
  );
}

export function SelectField({
  label,
  required,
  error,
  placeholder,
  disabled,
  value,
  onValueChange,
  options,
  className,
}: SelectFieldProps) {
  return (
    <FieldWrapper 
      label={label} 
      required={required} 
      error={error} 
      className={className}
    >
      <Select 
        value={value} 
        onValueChange={onValueChange} 
        disabled={disabled}
      >
        <SelectTrigger className={error ? 'border-destructive' : ''}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldWrapper>
  );
}
