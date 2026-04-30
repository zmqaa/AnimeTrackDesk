
const CACHE_TTL_MS = 10 * 60 * 1000;

export const readSessionCache = <T,>(key: string): T | null => {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { ts: number; data: T };
        if (!parsed?.ts || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
        return parsed.data;
    } catch {
        return null;
    }
};

export const writeSessionCache = <T,>(key: string, data: T) => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
};
