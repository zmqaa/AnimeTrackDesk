/**
 * 统一日期/时间格式化工具
 * 合并自 Dashboard.tsx、seasons/page.tsx、utils.ts 中的重复实现
 */

/** 安全解析日期，无效时返回 null */
function safeDate(value: Date | string | undefined | null): Date | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

const TZ = 'Asia/Shanghai';

/** "2025年3月" 格式 */
export function formatPremiere(value?: string): string {
  const d = safeDate(value);
  if (!d) return '未补充';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', timeZone: TZ }).format(d);
}

/** "2025/03/18" 格式 */
export function formatUpdateDate(value: string): string {
  const d = safeDate(value);
  if (!d) return value;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(d);
}

/** "03/18 14:30" 格式 */
export function formatWatchMoment(value: Date): string {
  if (Number.isNaN(value.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(value);
}

/** "03/18" 短日期 */
export function formatShortDate(value?: string): string {
  const d = safeDate(value);
  if (!d) return '未触达';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', timeZone: TZ }).format(d);
}

/** "2025年3月18日" 完整日期 */
export function formatDate(date: Date | string): string {
  const d = safeDate(date);
  if (!d) return '无效日期';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ });
}

/** "14:30:00" 时间 */
export function formatTime(date: Date | string): string {
  const d = safeDate(date);
  if (!d) return '无效日期';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });
}

/** "3分钟前" / "2小时前" 相对时间 */
export function getRelativeTime(date: Date | string): string {
  const d = safeDate(date);
  if (!d) return '未知时间';

  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
}

/** 生成唯一ID */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
