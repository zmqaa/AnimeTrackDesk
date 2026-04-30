import { createAiRuntimeConfig, getAiApiKey, requestAiJson } from '../ai-runtime';
import {
  toOptionalString,
  toOptionalNumber,
  toOptionalBoolean,
  toOptionalDateString,
  toStringArray,
} from '../ai-validation';

export interface AiAnimeMetadata {
  title?: string;
  originalTitle?: string;
  totalEpisodes?: number;
  durationMinutes?: number;
  summary?: string;
  tags?: string[];
  premiereDate?: string;
  isFinished?: boolean;
  coverUrl?: string;
}

const AI_RUNTIME = createAiRuntimeConfig();

export async function fetchAiAnimeMetadata(queryName: string, providedApiKey?: string): Promise<AiAnimeMetadata | null> {
  const normalizedQuery = String(queryName || '').trim();
  if (!normalizedQuery) {
    return null;
  }

  const apiKey = String(providedApiKey || getAiApiKey()).trim();
  const payload = await requestAiJson<Record<string, unknown>>({
    ...AI_RUNTIME,
    apiKey,
    messages: [
      {
        role: 'system',
        content: '你是动漫资料整理助手，只输出 JSON，不输出解释。信息不确定时宁可留空，不要编造。',
      },
      {
        role: 'user',
        content: `
请识别这部动画，并返回 JSON。

原始名字：${normalizedQuery}

返回结构：
{
  "officialTitle": "通行显示标题",
  "originalTitle": "日文原始标题",
  "totalEpisodes": 12,
  "durationMinutes": 24,
  "synopsis": "简体中文简介",
  "tags": ["校园", "喜剧"],
  "premiereDate": "YYYY-MM-DD 或 null",
  "isFinished": true,
  "coverUrl": null
}

字段要求：
1. officialTitle 表示这部动画在记录列表中最自然、最稳定的通行标题，不是字段名意义上的“必须中文”。
2. 如果某部作品没有稳定常用的中文标题，或中文译名明显生硬、不自然，就保留更通行的原文/英文/罗马字写法，例如“Slow Start”“NEW GAME!”；不要为了中文而生造翻译。
3. 如果有稳定通行的中文标题，优先返回中文标题，例如“葬送的芙莉莲”“孤独摇滚！”。
4. 如果是分季、续作、剧场版、OVA、OAD，返回该具体动画条目的标题。
5. 如果某一季有稳定通行的官方中文副标题，优先返回副标题形式，例如“南家三姐妹 再来一碗”；不要强行改写成“南家三姐妹 第二季”。
6. originalTitle 是最关键的字段之一，必须返回该动画条目在日本官方使用的日文标题（含日文汉字、假名、英文混写均可），例如"SPY×FAMILY Season 2""僕のヒーローアカデミア""Re:ゼロから始める異世界生活"。这个字段会被用来搜索 Bangumi 等数据库，所以必须是可搜索的准确标题，不要返回中文翻译。
7. 所有字段都必须对应动画版本本身，不要混入漫画连载开始时间、原作书名或企划信息。
8. premiereDate 是该动画第一集的电视/网络首播日期，精确到日。如果该季动画是 2022 年播出的，就不能填 2025 年的日期。不确定就填 null，绝对不要猜测。
9. 注意区分不同季度：例如"间谍过家家"第一季首播于 2022 年 4 月，第二季首播于 2023 年 10 月，不要搞混。
如果无法识别，也返回同结构，但未知字段用 null 或空数组。`,
      },
    ],
    temperature: 0.1,
    timeoutMs: 30000,
    cache: 'no-store',
  });

  if (!payload) {
    return null;
  }

  return {
    title: toOptionalString(payload.officialTitle) || normalizedQuery,
    originalTitle: toOptionalString(payload.originalTitle),
    totalEpisodes: toOptionalNumber(payload.totalEpisodes),
    durationMinutes: toOptionalNumber(payload.durationMinutes),
    summary: toOptionalString(payload.synopsis),
    tags: toStringArray(payload.tags),
    premiereDate: toOptionalDateString(payload.premiereDate),
    isFinished: toOptionalBoolean(payload.isFinished),
    coverUrl: toOptionalString(payload.coverUrl),
  };
}