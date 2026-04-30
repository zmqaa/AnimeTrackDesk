"use client";

import { createElement, type ComponentProps } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { PieChart } from "echarts/charts";
import { TitleComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([PieChart, SVGRenderer, TitleComponent, TooltipComponent]);

type ReactEChartsProps = Omit<ComponentProps<typeof ReactEChartsCore>, "echarts">;

function ReactECharts(props: ReactEChartsProps) {
	return createElement(ReactEChartsCore, {
		...props,
		echarts,
	});
}

export { ReactECharts };