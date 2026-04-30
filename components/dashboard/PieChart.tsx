"use client";

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { ReactECharts } from './echarts-pie';

interface PieChartItem {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieChartItem[];
  size?: number;
}

export function PieChart({ data, size = 168 }: PieChartProps) {
  const chartData = useMemo(() => data.filter((item) => item.value > 0), [data]);
  const total = useMemo(() => chartData.reduce((sum, item) => sum + item.value, 0), [chartData]);

  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 450,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      confine: false,
      backgroundColor: 'rgba(8, 14, 13, 0.96)',
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
      textStyle: {
        color: '#eef9ff',
        fontSize: 12,
        fontFamily: 'var(--font-body), sans-serif',
      },
      extraCssText: 'box-shadow: 0 18px 40px rgba(0,0,0,0.35); border-radius: 14px; padding: 10px 12px;',
      formatter: (params: unknown) => {
        const item = params as { name: string; value: number; percent: number; color: string };
        return [
          `<div style="display:flex; align-items:center; gap:8px; font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#94a3b8;">`,
          `<span style="width:8px; height:8px; border-radius:999px; background:${item.color}; display:inline-block;"></span>`,
          `Year Band</div>`,
          `<div style="margin-top:6px; color:#f8fafc; font-size:14px;">${item.name}</div>`,
          `<div style="margin-top:4px; color:#cbd5e1;">${item.value} 部作品 · ${item.percent}%</div>`,
        ].join('');
      },
    },
    title: total > 0 ? {
      text: `${total}`,
      subtext: '部作品',
      left: 'center',
      top: '39%',
      textStyle: {
        color: '#e6f7ff',
        fontSize: 24,
        fontWeight: 600,
      },
      subtextStyle: {
        color: '#7c8a86',
        fontSize: 10,
      },
    } : undefined,
    series: [
      {
        type: 'pie',
        radius: ['44%', '72%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: {
          borderColor: '#091311',
          borderWidth: 2,
        },
        emphasis: {
          scale: true,
          scaleSize: 6,
          itemStyle: {
            borderColor: 'rgba(255,255,255,0.75)',
            borderWidth: 2,
          },
        },
        data: chartData.map((item) => ({
          name: item.label,
          value: item.value,
          itemStyle: {
            color: item.color,
          },
        })),
      },
    ],
  }), [chartData, total]);

  if (!chartData.length) {
    return (
      <div
        className="surface-card-muted flex items-center justify-center rounded-full text-sm text-zinc-500"
        style={{ width: size, height: size }}
      >
        暂无数据
      </div>
    );
  }

  return <ReactECharts option={option} notMerge lazyUpdate opts={{ renderer: 'svg' }} style={{ width: size, height: size }} />;
}
