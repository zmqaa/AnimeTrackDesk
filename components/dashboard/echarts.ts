"use client";

import { createElement, type ComponentProps } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  GridComponent,
  LineChart,
  SVGRenderer,
  TooltipComponent,
]);

type ReactEChartsProps = Omit<ComponentProps<typeof ReactEChartsCore>, "echarts">;

function ReactECharts(props: ReactEChartsProps) {
  return createElement(ReactEChartsCore, {
    ...props,
    echarts,
  });
}

const { graphic } = echarts;

export { ReactECharts, graphic };