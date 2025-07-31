import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Reusable loading state component
 */
export function LoadingState({ 
  message = 'Loading...', 
  size = 'md',
  className = '' 
}: LoadingStateProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6', 
    lg: 'h-8 w-8'
  };

  const textSizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  };

  return (
    <div className={`flex items-center justify-center space-x-2 ${className}`}>
      <Loader2 className={`animate-spin ${sizeClasses[size]}`} />
      <span className={textSizeClasses[size]}>{message}</span>
    </div>
  );
}

/**
 * Full page loading component
 */
export function PageLoading({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <LoadingState message={message} size="lg" />
    </div>
  );
}

/**
 * Card/section loading component
 */
export function SectionLoading({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-48">
      <LoadingState message={message} size="md" />
    </div>
  );
}

/**
 * Button loading component
 */
export function ButtonLoading({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center space-x-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{message}</span>
    </div>
  );
}
