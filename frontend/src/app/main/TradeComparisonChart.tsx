"use client";

// Purchases and sales side by side (grouped bars) for the dashboard trend
// card. Same echarts pieces and token colors as PurchaseTrendChart.tsx; the
// two trends are merged by date (a day missing from one series counts as 0).

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatJalali, toPersianDigits } from "@/lib/jalali";
import { compactNumber, fullNumber, localDate, shortJalali, useChartTokens, type TrendPoint } from "./PurchaseTrendChart";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export default function TradeComparisonChart({ purchases, sales, bucket }: { purchases: TrendPoint[]; sales: TrendPoint[]; bucket: "day" | "week" }) {
  const tokens = useChartTokens();
  const purchaseByDate = new Map(purchases.map((point) => [point.date, point]));
  const salesByDate = new Map(sales.map((point) => [point.date, point]));
  const dates = [...new Set([...purchaseByDate.keys(), ...salesByDate.keys()])].sort();

  const option = {
    textStyle: { fontFamily: tokens.fontFamily },
    animationDuration: 300,
    grid: { top: 32, bottom: 4, left: 8, right: 8, containLabel: true },
    legend: { top: 0, textStyle: { color: tokens.axisLabel, fontFamily: tokens.fontFamily, fontSize: 12 }, itemWidth: 10, itemHeight: 10 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: tokens.grid, opacity: 0.35 } },
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.tooltipBorder,
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: tokens.tooltipFg, fontFamily: tokens.fontFamily, fontSize: 12 },
      extraCssText: "direction: rtl; text-align: right; box-shadow: none; border-radius: 6px;",
      formatter: (params: { dataIndex: number }[]) => {
        const date = dates[params[0]?.dataIndex ?? 0];
        if (!date) return "";
        const purchase = purchaseByDate.get(date);
        const sale = salesByDate.get(date);
        const heading = bucket === "week" ? `هفته از ${formatJalali(localDate(date))}` : formatJalali(localDate(date));
        const row = (label: string, point: TrendPoint | undefined, unit: string) =>
          `<div>${label}: ${fullNumber.format(Number(point?.amount ?? 0))} ریال (${toPersianDigits(point?.count ?? 0)} ${unit})</div>`;
        return `<div style="font-weight:600;margin-bottom:2px">${heading}</div>${row("خرید", purchase, "خرید")}${row("فروش", sale, "فاکتور")}`;
      },
    },
    xAxis: {
      type: "category",
      inverse: true,
      data: dates.map(shortJalali),
      axisLine: { lineStyle: { color: tokens.grid } },
      axisTick: { show: false },
      axisLabel: { color: tokens.axisLabel, fontSize: 11, hideOverlap: true },
    },
    // Purchases and sales differ by orders of magnitude, so each has its own
    // value axis (red on the right for purchases, green on the left for sales);
    // the bars still sit side by side per date on the shared date axis.
    yAxis: [
      {
        type: "value",
        position: "right",
        splitNumber: 4,
        axisLabel: { color: tokens.bar, fontSize: 11, formatter: (value: number) => compactNumber.format(value) },
        splitLine: { lineStyle: { color: tokens.grid, type: "dashed" } },
      },
      {
        type: "value",
        position: "left",
        splitNumber: 4,
        axisLabel: { color: tokens.bar2, fontSize: 11, formatter: (value: number) => compactNumber.format(value) },
        splitLine: { show: false },
      },
    ],
    series: [
      { type: "bar", name: "خرید", yAxisIndex: 0, barGap: "10%", data: dates.map((date) => Number(purchaseByDate.get(date)?.amount ?? 0)), barMaxWidth: 14, itemStyle: { color: tokens.bar, borderRadius: [4, 4, 0, 0] } },
      { type: "bar", name: "فروش", yAxisIndex: 1, data: dates.map((date) => Number(salesByDate.get(date)?.amount ?? 0)), barMaxWidth: 14, itemStyle: { color: tokens.bar2, borderRadius: [4, 4, 0, 0] } },
    ],
  };

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 256, width: "100%" }} opts={{ renderer: "canvas" }} aria-label="نمودار مقایسه خرید و فروش در بازه انتخاب‌شده" />;
}
