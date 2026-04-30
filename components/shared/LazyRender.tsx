'use client';

import { useEffect, useRef, useState } from 'react';

interface LazyRenderProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  rootMargin?: string;
}

export default function LazyRender({ children, fallback, rootMargin = '200px' }: LazyRenderProps) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isVisible) return;
    const node = ref.current;
    if (!node) return;

    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible, rootMargin]);

  return (
    <div ref={ref}>
      {isVisible ? children : fallback ?? <div className="glass-panel rounded-[24px] h-48 animate-pulse" />}
    </div>
  );
}
