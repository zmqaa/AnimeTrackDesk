import type { AnimeDetailItem, AnimeListItem, AnimeStatus } from "@/lib/anime-shared";

export type PreferenceInsightTone = "comfort" | "mixed" | "warning";

export interface AnimePreferenceInsight {
  tone: PreferenceInsightTone;
  headline: string;
  message: string;
  profileSummary: string;
  favoriteTags: string[];
  matchingTags: string[];
  warningTags: string[];
  reasonBadges: string[];
}

interface ProfileSnapshot {
  favoriteTags: string[];
  gentleTags: string[];
  intenseTags: string[];
}

const GENTLE_TAG_KEYWORDS = [
  "日常",
  "治愈",
  "纯爱",
  "恋爱",
  "百合",
  "轻百合",
  "校园",
  "搞笑",
  "喜剧",
  "温馨",
  "轻松",
  "甜",
  "慢热",
  "萌",
];

const INTENSE_TAG_RULES = [
  { keyword: "病娇", label: "病娇" },
  { keyword: "猎奇", label: "猎奇" },
  { keyword: "惊悚", label: "惊悚" },
  { keyword: "恐怖", label: "恐怖" },
  { keyword: "黑暗", label: "黑暗" },
  { keyword: "致郁", label: "致郁" },
  { keyword: "悬疑", label: "悬疑" },
  { keyword: "犯罪", label: "犯罪" },
  { keyword: "心理", label: "心理压迫" },
  { keyword: "血", label: "血腥" },
  { keyword: "暴力", label: "暴力" },
  { keyword: "死亡", label: "死亡要素" },
  { keyword: "扭曲", label: "关系扭曲" },
  { keyword: "控制", label: "控制欲" },
  { keyword: "绑架", label: "绑架" },
  { keyword: "诱拐", label: "诱拐" },
  { keyword: "虐待", label: "虐待" },
  { keyword: "校园霸凌", label: "校园霸凌" },
  { keyword: "精神", label: "精神压力" },
];

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function normalizeTags(tags: string[] | undefined) {
  return Array.from(
    new Set(
      (tags || [])
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function getStatusWeight(status: AnimeStatus) {
  if (status === "completed") {
    return 3;
  }

  if (status === "watching") {
    return 2;
  }

  return 1;
}

function getScoreWeight(score: number | undefined) {
  if (!score || score <= 0) {
    return 1;
  }

  return score >= 9 ? 2.2 : score >= 8 ? 1.8 : score >= 7 ? 1.4 : 1;
}

function rankTopTags(library: AnimeListItem[]) {
  const tagWeights = new Map<string, number>();

  for (const record of library) {
    const tags = normalizeTags(record.tags);
    if (tags.length === 0) {
      continue;
    }

    const recordWeight = getStatusWeight(record.status) * getScoreWeight(record.score);
    for (const tag of tags) {
      tagWeights.set(tag, (tagWeights.get(tag) || 0) + recordWeight);
    }
  }

  return Array.from(tagWeights.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([tag]) => tag);
}

function pickKeywords(source: string[], keywordPool: string[]) {
  const normalizedPool = keywordPool.map(normalizeToken);
  return source.filter((tag) => {
    const normalizedTag = normalizeToken(tag);
    return normalizedPool.some((keyword) => normalizedTag.includes(keyword));
  });
}

function collectWarningTags(item: Pick<AnimeDetailItem, "tags" | "summary" | "title" | "originalTitle">) {
  const haystack = [item.title, item.originalTitle, item.summary, ...(item.tags || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matched = INTENSE_TAG_RULES
    .filter((rule) => haystack.includes(rule.keyword.toLowerCase()))
    .map((rule) => rule.label);

  return Array.from(new Set(matched));
}

function buildProfileSnapshot(library: AnimeListItem[]): ProfileSnapshot {
  const rankedTags = rankTopTags(library);
  const favoriteTags = rankedTags.slice(0, 5);
  const gentleTags = pickKeywords(favoriteTags, GENTLE_TAG_KEYWORDS);
  const intenseTags = pickKeywords(favoriteTags, INTENSE_TAG_RULES.map((rule) => rule.keyword));

  return {
    favoriteTags,
    gentleTags,
    intenseTags,
  };
}

function buildProfileSummary(profile: ProfileSnapshot) {
  if (profile.favoriteTags.length === 0) {
    return "你现在的库里标签还不够多，先把这部收下，画像会慢慢成形。";
  }

  if (profile.gentleTags.length >= 2) {
    return `你的库存明显偏向 ${profile.gentleTags.slice(0, 3).join(" / ")} 这一类舒适区。`;
  }

  return `你最近常看的标签集中在 ${profile.favoriteTags.slice(0, 4).join(" / ")}。`;
}

export function analyzeAnimePreferenceInsight(
  item: Pick<AnimeDetailItem, "id" | "title" | "originalTitle" | "tags" | "summary">,
  library: AnimeListItem[],
): AnimePreferenceInsight {
  const comparableLibrary = library.filter((entry) => entry.id !== item.id);
  const profile = buildProfileSnapshot(comparableLibrary);
  const itemTags = normalizeTags(item.tags);
  const matchingTags = itemTags.filter((tag) => profile.favoriteTags.includes(tag));
  const warningTags = collectWarningTags(item);
  const reasonBadges: string[] = [];

  if (matchingTags.length > 0) {
    reasonBadges.push(`命中常看标签 ${matchingTags.slice(0, 3).join(" / ")}`);
  }

  if (warningTags.length > 0) {
    reasonBadges.push(`含 ${warningTags.slice(0, 3).join(" / ")} 要素`);
  }

  if (profile.gentleTags.length > 0) {
    reasonBadges.push(`你的舒适区偏 ${profile.gentleTags.slice(0, 2).join(" / ")}`);
  }

  const comfortMismatch = profile.gentleTags.length >= 2 && warningTags.length >= 2;
  const strongMatch = matchingTags.length >= 2;
  const lowMatch = matchingTags.length === 0 && itemTags.length > 0;

  if (comfortMismatch) {
    return {
      tone: "warning",
      headline: "口味偏离预警",
      message: `这部里有 ${warningTags.slice(0, 3).join("、")} 之类的高压要素，而你的库存更常见的是 ${profile.gentleTags.slice(0, 3).join("、")}。如果你本来是来找轻松纯爱的，这部大概率会突然把气氛拧歪。`,
      profileSummary: buildProfileSummary(profile),
      favoriteTags: profile.favoriteTags,
      matchingTags,
      warningTags,
      reasonBadges,
    };
  }

  if (strongMatch && warningTags.length === 0) {
    return {
      tone: "comfort",
      headline: "高相似口味命中",
      message: `它和你常收的 ${matchingTags.slice(0, 3).join("、")} 标签重合度很高，基本还在你的稳定舒适区里。`,
      profileSummary: buildProfileSummary(profile),
      favoriteTags: profile.favoriteTags,
      matchingTags,
      warningTags,
      reasonBadges,
    };
  }

  if (warningTags.length > 0 || lowMatch) {
    return {
      tone: "mixed",
      headline: warningTags.length > 0 ? "录入前看一眼风味差异" : "这部不太像你平时会点开的类型",
      message: warningTags.length > 0
        ? `这部不一定是雷，但它带着 ${warningTags.slice(0, 3).join("、")} 这种更刺激的成分，和你常看的标签有明显温差。`
        : `当前标签和你常看的 ${profile.favoriteTags.slice(0, 3).join("、")} 交集不高，可能是一次脱离舒适区的试探。`,
      profileSummary: buildProfileSummary(profile),
      favoriteTags: profile.favoriteTags,
      matchingTags,
      warningTags,
      reasonBadges,
    };
  }

  return {
    tone: "comfort",
    headline: "整体还算顺口",
    message: "它至少和你的库存没有明显冲突，虽然不是高度同类，但看起来不会突然越界。",
    profileSummary: buildProfileSummary(profile),
    favoriteTags: profile.favoriteTags,
    matchingTags,
    warningTags,
    reasonBadges,
  };
}