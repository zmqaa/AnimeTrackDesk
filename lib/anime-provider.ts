import { extractSeasonNumber, normalizeTitleToken, stripSeasonToken } from './chinese-parser';

export interface AnimeMetadata {
    coverUrl?: string;
    totalEpisodes?: number;
    title?: string;
    originalTitle?: string;
    score?: number;
    durationMinutes?: number;
    description?: string;
    premiereDate?: string;
    cast?: string[];
    castAliases?: string[];
    isFinished?: boolean;
    tags?: string[];
}

export interface AnimeMetadataCandidate {
    id: number;
    title: string;
    originalTitle?: string;
    score: number;
    season?: number;
}

export interface AnimeMetadataQueryTrace {
    query: string;
    candidateCount: number;
    candidates: AnimeMetadataCandidate[];
    selected?: AnimeMetadataCandidate;
}

export interface AnimeMetadataLookupResult {
    metadata: AnimeMetadata | null;
    trace: AnimeMetadataQueryTrace[];
    selected?: AnimeMetadataCandidate;
}

type ScoredBangumiCandidate = {
    subject: BangumiV0Subject;
    score: number;
};

type AggregatedBangumiCandidate = {
    subject: BangumiV0Subject;
    totalScore: number;
    bestScore: number;
    matchedQueryCount: number;
    firstQueryIndex: number;
};

export interface AnimeMetadataSearchCandidate {
    id: number;
    title: string;
    originalTitle?: string;
    coverUrl?: string;
    score?: number;
    description?: string;
    premiereDate?: string;
    totalEpisodes?: number;
    durationMinutes?: number;
    tags?: string[];
    isFinished?: boolean;
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

function stringifyInfoboxValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value.map(stringifyInfoboxValue).filter(Boolean).join(' ');
    }

    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).map(stringifyInfoboxValue).filter(Boolean).join(' ');
    }

    return '';
}

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function extractSubjectTags(detail: BangumiV0Subject) {
    return Array.isArray(detail.tags)
        ? detail.tags.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 12).map((tag) => tag.name).filter(Boolean)
        : undefined;
}

function extractSubjectTotalEpisodes(detail: BangumiV0Subject) {
    if (detail.eps && detail.eps > 0) {
        return detail.eps;
    }

    const entry = detail.infobox?.find((item) => item.key === '话数' || item.key === '集数');
    const parsed = parseInt(String(entry?.value ?? ''), 10);
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : undefined;
}

function toAnimeMetadataSearchCandidate(detail: BangumiV0Subject): AnimeMetadataSearchCandidate {
    return {
        id: detail.id,
        title: detail.name_cn || detail.name,
        originalTitle: detail.name,
        coverUrl: detail.images?.large ?? detail.images?.common ?? detail.images?.medium,
        score: detail.rating?.score && detail.rating.score > 0
            ? Math.round(detail.rating.score * 10) / 10
            : undefined,
        description: detail.summary?.trim() || undefined,
        premiereDate: normalizeDate(detail.date),
        totalEpisodes: extractSubjectTotalEpisodes(detail),
        durationMinutes: extractDurationMinutes(detail),
        tags: extractSubjectTags(detail),
        isFinished: extractIsFinished(detail),
    };
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

function scoreBangumiCandidates(candidates: BangumiV0Subject[], keyword: string): ScoredBangumiCandidate[] {
    if (candidates.length === 0) return [];
    const keywordToken = normalizeTitleToken(keyword);
    const keywordBaseToken = normalizeTitleToken(stripSeasonToken(keyword));
    const keywordSeason = extractSeasonNumber(keyword);

    return candidates
        .map((subject) => {
            const titleToken = normalizeTitleToken(subject.name);
            const titleCnToken = normalizeTitleToken(subject.name_cn);
            const baseTitleToken = normalizeTitleToken(stripSeasonToken(subject.name));
            const baseTitleCnToken = normalizeTitleToken(stripSeasonToken(subject.name_cn));
            const subjectSeason = extractSeasonNumber(subject.name_cn) ?? extractSeasonNumber(subject.name);

            let score = 0;
            if (subject.name === keyword || subject.name_cn === keyword) score += 1000;
            if (keywordToken && (titleToken === keywordToken || titleCnToken === keywordToken)) score += 800;
            if (keywordBaseToken && (baseTitleToken === keywordBaseToken || baseTitleCnToken === keywordBaseToken)) score += 200;
            if (keywordToken && (
                titleToken.includes(keywordToken)
                || keywordToken.includes(titleToken)
                || titleCnToken.includes(keywordToken)
                || keywordToken.includes(titleCnToken)
            )) score += 80;

            if (keywordSeason && subjectSeason === keywordSeason) {
                score += 300;
            } else if (keywordSeason && subjectSeason && subjectSeason !== keywordSeason) {
                score -= 400;
            }

            return { subject, score };
        })
        .sort((left, right) => right.score - left.score);
}

function aggregateBangumiCandidates(
    queryResults: Array<{ queryIndex: number; candidates: ScoredBangumiCandidate[] }>,
): AggregatedBangumiCandidate[] {
    const aggregated = new Map<number, AggregatedBangumiCandidate>();

    for (const result of queryResults) {
        const priorityBonus = Math.max(0, 30 - result.queryIndex * 5);

        for (const candidate of result.candidates) {
            if (candidate.score <= 0) {
                continue;
            }

            const existing = aggregated.get(candidate.subject.id);
            if (existing) {
                existing.totalScore += candidate.score + priorityBonus;
                existing.bestScore = Math.max(existing.bestScore, candidate.score);
                existing.matchedQueryCount += 1;
                existing.firstQueryIndex = Math.min(existing.firstQueryIndex, result.queryIndex);
                continue;
            }

            aggregated.set(candidate.subject.id, {
                subject: candidate.subject,
                totalScore: candidate.score + priorityBonus,
                bestScore: candidate.score,
                matchedQueryCount: 1,
                firstQueryIndex: result.queryIndex,
            });
        }
    }

    return Array.from(aggregated.values())
        .map((candidate) => ({
            ...candidate,
            totalScore: candidate.totalScore + candidate.matchedQueryCount * 500,
        }))
        .sort((left, right) => {
            if (left.totalScore !== right.totalScore) {
                return right.totalScore - left.totalScore;
            }

            if (left.matchedQueryCount !== right.matchedQueryCount) {
                return right.matchedQueryCount - left.matchedQueryCount;
            }

            if (left.bestScore !== right.bestScore) {
                return right.bestScore - left.bestScore;
            }

            return left.firstQueryIndex - right.firstQueryIndex;
        });
}

function toAnimeMetadataCandidate(candidate: { subject: BangumiV0Subject; score: number }): AnimeMetadataCandidate {
    return {
        id: candidate.subject.id,
        title: candidate.subject.name_cn || candidate.subject.name,
        originalTitle: candidate.subject.name,
        score: candidate.score,
        season: extractSeasonNumber(candidate.subject.name_cn) ?? extractSeasonNumber(candidate.subject.name),
    };
}

/** 从搜索结果中挑出最佳匹配：优先 name 精确匹配，次选 partial，保持与查询词的一致性 */
function pickBestMatch(candidates: BangumiV0Subject[], keyword: string): BangumiV0Subject | null {
    const scored = scoreBangumiCandidates(candidates, keyword);

    return scored[0] && scored[0].score > 0 ? scored[0].subject : null;
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

function extractDurationMinutes(detail: BangumiV0Subject): number | undefined {
    const entry = detail.infobox?.find((item) => /时长|片长|单集片长|播放时长|放送时长|每话长|每集长/i.test(String(item.key ?? '')));
    if (!entry) {
        return undefined;
    }

    const text = stringifyInfoboxValue(entry.value).replace(/\s+/g, ' ').trim();
    if (!text) {
        return undefined;
    }

    const minuteMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:分钟|分|min|mins|minute|minutes)\b/i)
        || text.match(/(?:约|每集|每话)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m)\b/i)
        || text.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!minuteMatch) {
        return undefined;
    }

    const parsed = Number(minuteMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

/**
 * 尝试多个查询词依次搜索 Bangumi，返回第一个成功匹配的元数据。
 * 调用方通常按「日文原名 → 标准中文名 → 用户输入」顺序传入。
 */
export async function fetchAnimeMetadata(title: string): Promise<AnimeMetadata | null> {
    return fetchAnimeMetadataByQueries(title);
}

export async function fetchAnimeMetadataByQueriesWithTrace(
    ...queries: Array<string | undefined | null>
): Promise<AnimeMetadataLookupResult> {
    const validQueries = queries.map(q => (q ?? '').trim()).filter(Boolean);
    if (validQueries.length === 0) {
        return { metadata: null, trace: [], selected: undefined };
    }

    const trace: AnimeMetadataQueryTrace[] = [];

    const queryResults: Array<{ queryIndex: number; candidates: ScoredBangumiCandidate[] }> = [];

    for (const [queryIndex, keyword] of validQueries.entries()) {
        const candidates = await searchBangumiV0(keyword);
        const scoredCandidates = scoreBangumiCandidates(candidates, keyword);
        const selected = scoredCandidates[0] && scoredCandidates[0].score > 0 ? scoredCandidates[0] : null;

        queryResults.push({ queryIndex, candidates: scoredCandidates });

        trace.push({
            query: keyword,
            candidateCount: candidates.length,
            candidates: scoredCandidates.slice(0, 4).map(toAnimeMetadataCandidate),
            selected: selected ? toAnimeMetadataCandidate(selected) : undefined,
        });
    }

    const aggregatedCandidates = aggregateBangumiCandidates(queryResults);
    const selected = aggregatedCandidates[0];
    if (!selected || selected.totalScore <= 0) {
        return { metadata: null, trace, selected: undefined };
    }

    const selectedCandidate = toAnimeMetadataCandidate({ subject: selected.subject, score: selected.totalScore });

    const [detail, characters] = await Promise.all([
        fetchSubjectDetail(selected.subject.id),
        fetchSubjectCharacters(selected.subject.id),
    ]);

    if (!detail) {
        return { metadata: null, trace, selected: selectedCandidate };
    }

    const tags = extractSubjectTags(detail);
    const totalEpisodes = extractSubjectTotalEpisodes(detail);

    return {
        metadata: {
            title: detail.name_cn || detail.name,
            originalTitle: detail.name,
            coverUrl: detail.images?.large ?? detail.images?.common ?? detail.images?.medium,
            score: detail.rating?.score && detail.rating.score > 0
                ? Math.round(detail.rating.score * 10) / 10
                : undefined,
            durationMinutes: extractDurationMinutes(detail),
            totalEpisodes,
            description: detail.summary?.trim() || undefined,
            premiereDate: normalizeDate(detail.date),
            tags,
            isFinished: extractIsFinished(detail),
            cast: extractCast(characters),
        },
        trace,
        selected: selectedCandidate,
    };
}

export async function fetchAnimeMetadataByQueries(
    ...queries: Array<string | undefined | null>
): Promise<AnimeMetadata | null> {
    const result = await fetchAnimeMetadataByQueriesWithTrace(...queries);
    return result.metadata;
}

export async function searchAnimeMetadataCandidatesByKeyword(keyword: string): Promise<AnimeMetadataSearchCandidate[]> {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
        return [];
    }

    const subjects = await searchBangumiV0(trimmedKeyword);
    return subjects.map(toAnimeMetadataSearchCandidate);
}

