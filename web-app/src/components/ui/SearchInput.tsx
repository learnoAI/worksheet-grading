import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className = '',
  disabled = false,
  autoFocus = false,
}: SearchInputProps) {
  const handleClear = () => {
    onChange('');
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-10 pr-10"
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
          onClick={handleClear}
          disabled={disabled}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
