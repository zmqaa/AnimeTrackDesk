import { Suspense } from 'react';
import BackupPageClient from './BackupPageClient';

export default function BackupPage() {
  return (
    <Suspense fallback={<main className="p-6 text-zinc-400">加载中...</main>}>
      <BackupPageClient />
    </Suspense>
  );
}
