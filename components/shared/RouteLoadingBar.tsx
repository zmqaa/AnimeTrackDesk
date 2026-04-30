"use client";

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

function RouteLoadingBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 150);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  if (!loading) return null;

  return <div className="route-loading-bar" />;
}

export default function RouteLoadingBar() {
  return (
    <Suspense fallback={null}>
      <RouteLoadingBarInner />
    </Suspense>
  );
}
