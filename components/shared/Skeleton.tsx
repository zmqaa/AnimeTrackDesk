"use client";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`skeleton-shimmer rounded-2xl ${className}`} />
  );
}

export function AnimeCardSkeleton() {
  return (
    <div className="surface-card-muted rounded-2xl overflow-hidden">
      <div className="aspect-[3/4] skeleton-shimmer" />
      <div className="p-4 space-y-3">
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
        <Skeleton className="h-8 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-8 flex-[2]" />
        </div>
      </div>
    </div>
  );
}

export function AnimeGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <AnimeCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function AnimeListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="surface-card-muted flex gap-4 p-3 rounded-2xl">
          <Skeleton className="w-16 h-20 flex-shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-2 mt-2">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 py-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-1.5 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="glass-panel rounded-[28px] p-5 space-y-4">
          <Skeleton className="h-8 w-8 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
