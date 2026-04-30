import { NextRequest, NextResponse } from 'next/server';
import { listAnimeRecords } from '@/lib/anime';
import { getWatchHistory } from '@/lib/history';
import { requireAdmin } from '@/lib/api-response';

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** GET — export data as JSON or CSV */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin('需要管理员权限');
  if (!auth.authorized) {
    return auth.response;
  }

  const format = request.nextUrl.searchParams.get('format') || 'json';
  const table = request.nextUrl.searchParams.get('table') || 'all';

  const anime = table === 'history' ? [] : await listAnimeRecords();
  const history = table === 'anime' ? [] : await getWatchHistory();

  if (format === 'csv') {
    const lines: string[] = [];

    if (table !== 'history') {
      // Anime CSV header
      const animeHeaders = ['ID', '标题', '原标题', '状态', '评分', '进度', '总集数',
        '时长(分钟)', '首播日期', '开始日期', '结束日期', '标签', '备注'];
      lines.push(animeHeaders.map(escapeCsvValue).join(','));

      for (const a of anime) {
        lines.push([
          a.id, a.title, a.originalTitle || '', a.status, a.score ?? '',
          a.progress, a.totalEpisodes ?? '', a.durationMinutes ?? '',
          a.premiereDate || '', a.startDate || '', a.endDate || '',
          (a.tags || []).join('|'), a.notes || '',
        ].map(escapeCsvValue).join(','));
      }
    }

    if (table === 'all' && anime.length > 0 && history.length > 0) {
      lines.push('');
    }

    if (table !== 'anime') {
      // History CSV header
      const historyHeaders = ['ID', '番剧ID', '番剧名称', '集数', '观看时间'];
      lines.push(historyHeaders.map(escapeCsvValue).join(','));

      for (const h of history) {
        lines.push([
          h.id, h.animeId, h.animeTitle, h.episode, h.watchedAt,
        ].map(escapeCsvValue).join(','));
      }
    }

    // Add BOM for Excel compatibility
    const bom = '\uFEFF';
    const csv = bom + lines.join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="anime-track-export.csv"`,
      },
    });
  }

  // JSON format
  const data = {
    exportedAt: new Date().toISOString(),
    anime: table !== 'history' ? { count: anime.length, records: anime } : undefined,
    watchHistory: table !== 'anime' ? { count: history.length, records: history } : undefined,
  };

  const json = JSON.stringify(data, null, 2);

  return new NextResponse(json, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="anime-track-export.json"`,
    },
  });
}
