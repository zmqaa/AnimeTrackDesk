"use client";

import AnimeCard from './AnimeCard';
import AnimeListView from './AnimeListView';
import EmptyState from '@/components/shared/EmptyState';
import { AnimeGridSkeleton, AnimeListSkeleton } from '@/components/shared/Skeleton';
import type { AnimeCardItem } from '@/lib/anime-shared';

export type ViewMode = 'grid' | 'list';

interface AnimeGridProps {
  items: AnimeCardItem[];
  onEdit: (item: AnimeCardItem) => void;
  updateProgress: (id: number, current: number, total?: number | null) => Promise<void>;
  loading: boolean;
  isAdmin?: boolean;
  viewMode?: ViewMode;
  detailReturnTo: string;
  onOpenDetail: () => void;
}

export default function AnimeGrid({ items, onEdit, updateProgress, loading, isAdmin = false, viewMode = 'grid', detailReturnTo, onOpenDetail }: AnimeGridProps) {
  if (loading) {
    return viewMode === 'list' ? <AnimeListSkeleton /> : <AnimeGridSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="surface-card rounded-3xl">
        <EmptyState
          icon="📺"
          title="暂无番剧记录"
          description="你的片库还是空的，快去添加第一部番剧吧"
        />
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <AnimeListView
        items={items}
        onEdit={onEdit}
        updateProgress={updateProgress}
        isAdmin={isAdmin}
        detailReturnTo={detailReturnTo}
        onOpenDetail={onOpenDetail}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
      {items.map((item) => (
        <AnimeCard 
          key={item.id} 
          item={item} 
          onEdit={onEdit} 
          updateProgress={updateProgress}
          isAdmin={isAdmin}
          detailReturnTo={detailReturnTo}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}
