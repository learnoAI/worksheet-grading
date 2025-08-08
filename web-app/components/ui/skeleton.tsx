import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-muted/40 dark:bg-muted/30 animate-pulse',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.8s_infinite]',
        'before:bg-gradient-to-r before:from-transparent before:via-white/40 dark:before:via-white/10 before:to-transparent',
        className
      )}
      {...props}
    />
  );
}

export const SkeletonStyles = () => (
  <style jsx global>{`
    @keyframes shimmer { 100% { transform: translateX(100%); } }
  `}</style>
);
