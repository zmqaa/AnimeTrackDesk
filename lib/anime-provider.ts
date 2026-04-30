export interface AnimeMetadata {
    coverUrl?: string;
    totalEpisodes?: number;
    title?: string;
    originalTitle?: string;
    score?: number;
    description?: string;
    premiereDate?: string;
    cast?: string[];
    castAliases?: string[];
    isFinished?: boolean;
    tags?: string[];
}

function normalizeDateString(value: Date | string | number | null | undefined) {
    if (!value) {
        return undefined;
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            return undefined;
        }

        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
        return undefined;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ── Bangumi v0 API ────────────────────────────────────────────────────────────

const USER_AGENT = 'AnimeTrack/1.0 (personal tracker)';
const MAX_CAST_MEMBERS = 10;
const FETCH_TIMEOUT_MS = 8000;

interface BangumiV0Subject {
    id: number;
    name: string;
    name_cn?: string;
    date?: string;
    eps?: number;
    images?: { large?: string; common?: string; medium?: string };
    rating?: { score?: number };
    summary?: string;
    tags?: Array<{ name: string; count?: number }>;
    infobox?: Array<{ key: string; value: unknown }>;
}

interface BangumiV0Character {
    actors?: Array<{ name?: string; name_cn?: string }>;
}

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * 搜索 Bangumi v0，返回所有 name 精确匹配的候选，再返回 partial 候选。
 * 第一个 query 通常是日文原名（由 AI 提供），命中率极高。
 */
async function searchBangumiV0(keyword: string): Promise<BangumiV0Subject[]> {
    try {
        const res = await fetchWithTimeout('https://api.bgm.tv/v0/search/subjects?limit=10', {
            method: 'POST',
            headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, filter: { type: [2] }, sort: 'match' }),
        });
        if (!res.ok) return [];
        const data = await res.json() as { data?: BangumiV0Subject[] };
        return data?.data ?? [];
    } catch {
        return [];
    }
}

async function fetchSubjectDetail(subjectId: number): Promise<BangumiV0Subject | null> {
    try {
        const res = await fetchWithTimeout(`https://api.bgm.tv/v0/subjects/${subjectId}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok) return null;
        return res.json() as Promise<BangumiV0Subject>;
    } catch {
        return null;
    }
}

async function fetchSubjectCharacters(subjectId: number): Promise<BangumiV0Character[]> {
    try {
        const res = await fetchWithTimeout(`https://api.bgm.tv/v0/subjects/${subjectId}/characters`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok) return [];
        return res.json() as Promise<BangumiV0Character[]>;
    } catch {
        return [];
    }
}

/** 从搜索结果中挑出最佳匹配：优先 name 精确匹配，次选 partial，保持与查询词的一致性 */
function pickBestMatch(candidates: BangumiV0Subject[], keyword: string): BangumiV0Subject | null {
    if (candidates.length === 0) return null;
    // 精确：name 或 name_cn 完全一致
    const exact = candidates.find(s => s.name === keyword || s.name_cn === keyword);
    if (exact) return exact;
    // Partial：name 包含 keyword 或反之
    const partial = candidates.find(s =>
        s.name?.includes(keyword) || keyword.includes(s.name ?? '') ||
        (s.name_cn && (s.name_cn.includes(keyword) || keyword.includes(s.name_cn)))
    );
    return partial ?? candidates[0] ?? null;
}

export const normalizeDate = normalizeDateString;

function extractIsFinished(detail: BangumiV0Subject): boolean | undefined {
    const endEntry = detail.infobox?.find(i => i.key === '播放结束' || i.key === '放送结束');
    if (!endEntry?.value) return undefined;
    const dateStr = String(endEntry.value).replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/, '$1-$2-$3');
    const endDate = new Date(dateStr);
    if (isNaN(endDate.getTime())) return undefined;
    return endDate < new Date();
}

function extractCast(characters: BangumiV0Character[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ch of characters) {
        const name = ch.actors?.[0]?.name;
        if (name && !seen.has(name)) { seen.add(name); result.push(name); }
        if (result.length >= MAX_CAST_MEMBERS) break;
    }
    return result;
}

/**
 * 尝试多个查询词依次搜索 Bangumi，返回第一个成功匹配的元数据。
 * 调用方通常按「日文原名 → 标准中文名 → 用户输入」顺序传入。
 */
export async function fetchAnimeMetadata(title: string): Promise<AnimeMetadata | null> {
    return fetchAnimeMetadataByQueries(title);
}

export async function fetchAnimeMetadataByQueries(
    ...queries: Array<string | undefined | null>
): Promise<AnimeMetadata | null> {
    const validQueries = queries.map(q => (q ?? '').trim()).filter(Boolean);
    if (validQueries.length === 0) return null;

    for (const keyword of validQueries) {
        const candidates = await searchBangumiV0(keyword);
        if (candidates.length === 0) continue;

        const subject = pickBestMatch(candidates, keyword);
        if (!subject) continue;

        const [detail, characters] = await Promise.all([
            fetchSubjectDetail(subject.id),
            fetchSubjectCharacters(subject.id),
        ]);

        if (!detail) continue;

        const tags = Array.isArray(detail.tags)
            ? detail.tags.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 12).map(t => t.name).filter(Boolean)
            : undefined;

        const totalEpisodes = (detail.eps && detail.eps > 0)
            ? detail.eps
            : (() => {
                const entry = detail.infobox?.find(i => i.key === '话数' || i.key === '集数');
                const n = parseInt(String(entry?.value ?? ''), 10);
                return !isNaN(n) && n > 0 ? n : undefined;
            })();

        return {
            title: detail.name_cn || detail.name,
            originalTitle: detail.name,
            coverUrl: detail.images?.large ?? detail.images?.common ?? detail.images?.medium,
            score: detail.rating?.score && detail.rating.score > 0
                ? Math.round(detail.rating.score * 10) / 10
                : undefined,
            totalEpisodes,
            description: detail.summary?.trim() || undefined,
            premiereDate: normalizeDate(detail.date),
            tags,
            isFinished: extractIsFinished(detail),
            cast: extractCast(characters),
        };
    }

    return null;
}

