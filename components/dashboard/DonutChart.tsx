
"use client";

interface DonutChartItem {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutChartItem[];
  size?: number;
  strokeWidth?: number;
}

export function DonutChart({ data, size = 96, strokeWidth = 12 }: DonutChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;

  if (total === 0) {
    return (
      <svg width={size} height={size} className="text-zinc-800">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} className="-rotate-90">
      {data.map((item) => {
        const dash = (item.value / total) * circumference;
        const segment = (
          <circle
            key={item.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={item.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            fill="none"
            strokeLinecap="butt"
          />
        );
        offset += dash;
        return segment;
      })}
    </svg>
  );
}
