
"use client";

import { useState, useEffect, useMemo } from 'react';
import { WatchHistoryRecord, ParsedWatchHistory } from '@/lib/dashboard-types';
import { readSessionCache, writeSessionCache } from '@/lib/hooks-shared';
import { DESKTOP_DASHBOARD_CACHE_KEYS } from '@/src/lib/desktop-dashboard-shared';
import { loadDesktopWatchHistoryRecords } from '@/src/lib/desktop-anime-store';

export function useHistoryData() {
    const [watchHistory, setWatchHistory] = useState<WatchHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const parsedHistory = useMemo<ParsedWatchHistory[]>(() => {
        return watchHistory.map(h => {
            const d = new Date(h.watchedAt);
            return {
                ...h,
                dateObj: d,
                dateStr: h.watchedAt.split('T')[0],
                hour: d.getHours(),
                month: d.getMonth(),
                year: d.getFullYear()
            };
        });
    }, [watchHistory]);

    useEffect(() => {
        const cached = readSessionCache<WatchHistoryRecord[]>(DESKTOP_DASHBOARD_CACHE_KEYS.dashboardHistory);
        if (cached) {
            setWatchHistory(cached);
            setIsLoading(false);
            return;
        }

        setIsRefreshing(true);
        try {
            const entries = loadDesktopWatchHistoryRecords();
            setWatchHistory(entries);
            writeSessionCache(DESKTOP_DASHBOARD_CACHE_KEYS.dashboardHistory, entries);
        } catch (err) {
            console.error('Failed to load desktop history data', err);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    return { watchHistory, parsedHistory, isLoading, isRefreshing };
}
