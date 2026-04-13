import { Skeleton, SkeletonStyles } from '@/components/ui/skeleton';
import React from 'react';

export const PageSectionSkeleton: React.FC<{ count?: number }> = ({ count = 2 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="border rounded-lg p-6 space-y-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-3 pt-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full hidden md:block" />
        </div>
      </div>
    ))}
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({ rows = 6, columns = 5 }) => (
  <div className="border rounded-lg overflow-hidden">
    <div className="border-b p-6 space-y-2">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-64" />
    </div>
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={`grid gap-4 items-center`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const HeadingActionSkeleton: React.FC = () => (
  <div className="flex justify-between items-center">
    <Skeleton className="h-8 w-72" />
    <Skeleton className="h-9 w-48" />
  </div>
);

export const FormSkeleton: React.FC<{ fields?: number }> = ({ fields = 5 }) => (
  <div className="space-y-6">
    <HeadingActionSkeleton />
    <div className="border rounded-lg p-6 space-y-5">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <div className="flex justify-end gap-3 pt-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  </div>
);

export const FullPageSkeleton: React.FC = () => (
  <div className="space-y-6">
    <SkeletonStyles />
    <HeadingActionSkeleton />
    <PageSectionSkeleton />
    <TableSkeleton />
  </div>
);
