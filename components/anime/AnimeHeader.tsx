"use client";

import Link from 'next/link';
import { CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline';

interface AnimeHeaderProps {
  showForm: boolean;
  editingId: number | null;
  setShowForm: (v: boolean) => void;
  resetForm: () => void;
  isAdmin?: boolean;
}

export default function AnimeHeader({
  showForm,
  editingId,
  setShowForm,
  resetForm,
  isAdmin = false,
}: AnimeHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-light tracking-tight text-white">动漫追番</h1>
        <p className="text-zinc-500 text-sm mt-1">记录看过的每一部佳作</p>
      </div>
      
      <div className="flex items-center gap-2">
          <Link
              href="/anime/timeline"
                className="surface-pill flex items-center gap-2 px-4 py-2 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium transition-all"
          >
              <CalendarDaysIcon className="w-4 h-4" />
              <span>追番时光机</span>
          </Link>
          
          {isAdmin && (
            <>
              <button
                  onClick={() => { resetForm(); setShowForm(!showForm); }}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg hover:opacity-90 transition font-medium text-sm shadow-sm"
              >
                  <PlusIcon className="w-4 h-4" />
                  <span>{showForm && !editingId ? '取消' : '手动添加'}</span>
              </button>
            </>
          )}
      </div>
    </div>
  );
}
