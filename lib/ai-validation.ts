/**
 * AI 响应值类型强制/校验工具
 * 从 ai.ts 中抽取的通用校验函数
 */

import { uniqueStrings } from './anime-cast';

type ParsedQuickRecordStatus = 'watching' | 'completed' | 'dropped' | 'plan_to_watch';

export function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function toOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function toOptionalNonNegativeNumber(value: unknown): number | undefined {
  const parsed = toOptionalFiniteNumber(value);
  if (parsed === undefined || parsed < 0) return undefined;
  return parsed;
}

export function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function toOptionalDateString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = uniqueStrings(value.map((item) => (typeof item === 'string' ? item : String(item ?? ''))));
  return normalized.length > 0 ? normalized : undefined;
}

export function toOptionalQuickRecordStatus(value: unknown): ParsedQuickRecordStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized === 'watching' || normalized === 'completed' || normalized === 'dropped' || normalized === 'plan_to_watch') {
    return normalized;
  }
  return undefined;
}
