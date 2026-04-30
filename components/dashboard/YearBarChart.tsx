"use client";

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { CallbackDataParams } from 'echarts/types/src/util/types.js';
import { ReactECharts } from './echarts';

interface ChartItem {
  label: string;
  value: number;
  color?: string;
}

interface YearBarChartProps {
  data: ChartItem[];
  height?: number;
}

export function YearBarChart({ data, height = 220 }: YearBarChartProps) {
  const chartData = useMemo(() => {
    // Sort data chronologically based on prefix year
    return [...data].sort((a, b) => {
      const yearA = parseInt(a.label);
      const yearB = parseInt(b.label);
      if (!isNaN(yearA) && !isNaN(yearB)) return yearA - yearB;
      return a.label.localeCompare(b.label);
    });
  }, [data]);

  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 450,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(8, 14, 13, 0.96)',
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
      textStyle: {
        color: '#eef9ff',
        fontSize: 12,
        fontFamily: 'var(--font-body), sans-serif',
      },
      extraCssText: 'box-shadow: 0 18px 40px rgba(0,0,0,0.35); border-radius: 14px; padding: 10px 12px;',
      formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
        const item = Array.isArray(params) ? params[0] : params;
        return [
          `<div style="display:flex; align-items:center; gap:8px; font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#94a3b8;">`,
          `<span style="width:8px; height:8px; border-radius:999px; background:${item.color || '#5dd6f2'}; display:inline-block;"></span>`,
          `Year</div>`,
          `<div style="margin-top:6px; color:#f8fafc; font-size:14px;">${item.name}</div>`,
          `<div style="margin-top:4px; color:#cbd5e1;">${item.value} 部作品</div>`,
        ].join('');
      },
    },
    grid: {
      top: 10,
      right: 10,
      bottom: 24,
      left: 30,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: chartData.map(d => d.label.replace(' 年', '')),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 10,
        margin: 12,
      },
    },
    yAxis: {
      type: 'value',
      splitLine: {
        lineStyle: {
          color: 'rgba(255, 255, 255, 0.05)',
          type: 'dashed',
        },
      },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
      },
    },
    series: [
      {
        type: 'bar',
        data: chartData.map(d => ({
          value: d.value,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: d.color || '#5dd6f2' },
                { offset: 1, color: d.color ? d.color + '40' : 'rgba(93, 214, 242, 0.2)' }
              ]
            },
            borderRadius: [4, 4, 0, 0],
          }
        })),
        barMaxWidth: 24,
      },
    ],
  }), [chartData]);

  return (
    <div style={{ height: `${height}px`, width: '100%' }}>
      <ReactECharts 
        option={option} 
        style={{ height: '100%', width: '100%' }} 
        opts={{ renderer: 'svg' }}
      />
    </div>
  );
}