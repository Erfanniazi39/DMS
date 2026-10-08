"use client";

// Sales daily/weekly trend — three independent series (confirmed order
// amount, invoiced revenue, payments received) on the same date axis.
// Mirrors frontend/src/app/main/PurchaseTrendChart.tsx's conventions
// (app-token colors, RTL-inverted category axis, Jalali tooltip) but with
// multiple bar series instead of one — not a route, only this page's
// sibling, loaded via next/dynamic with ssr: false (echarts needs a real
// DOM canvas).

import { useEffect, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { JALALI_MONTH_NAMES, formatJalali, safeToJalali, toPersianDigits } from "@/lib/jalali";
import type { DailyTrendPoint } from "./shared";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type ChartTokens = {
  bars: [string, string, string];
  grid: string;
  axisLabel: string;
  tooltipBg: string;
  tooltipFg: string;
  tooltipBorder: string;
  fontFamily: string;
};

function readTokens(): ChartTokens {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  return {
    bars: [token("--chart-1"), token("--chart-2"), token("--chart-3")],
    grid: token("--border"),
    axisLabel: token("--muted-foreground"),
    tooltipBg: token("--popover"),
    tooltipFg: token("--popover-foreground"),
    tooltipBorder: token("--border"),
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

function useChartTokens() {
  const [tokens, setTokens] = useState<ChartTokens>(readTokens);
  useEffect(() => {
    const observer = new MutationObserver(() => setTokens(readTokens()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

function localDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`);
}

function shortJalali(isoDate: string) {
  const jalali = safeToJalali(localDate(isoDate));
  if (!jalali) return isoDate;
  const { jm, jd } = jalali;
  return `${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]}`;
}

const fullNumber = new Intl.NumberFormat("fa-IR");
const compactNumber = new Intl.NumberFormat("fa-IR", { notation: "compact", maximumFractionDigits: 1 });

export default function DailyTrendChart({ points, bucket }: { points: DailyTrendPoint[]; bucket: "day" | "week" }) {
  const tokens = useChartTokens();

  const series = [
    { key: "confirmedOrderAmount" as const, countKey: "confirmedOrderCount" as const, name: "سفارش‌های تأییدشده", color: tokens.bars[0] },
    { key: "invoicedAmount" as const, countKey: "invoicedCount" as const, name: "فاکتورشده", color: tokens.bars[1] },
    { key: "paymentAmount" as const, countKey: "paymentCount" as const, name: "دریافت‌شده", color: tokens.bars[2] },
  ];

  const option = {
    textStyle: { fontFamily: tokens.fontFamily },
    animationDuration: 300,
    legend: { top: 0, right: 0, textStyle: { color: tokens.axisLabel, fontFamily: tokens.fontFamily, fontSize: 11 } },
    grid: { top: 36, bottom: 4, left: 8, right: 8, containLabel: true },
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
        const point = points[params[0]?.dataIndex ?? 0];
        if (!point) return "";
        const heading = bucket === "week" ? `هفته از ${formatJalali(localDate(point.date))}` : formatJalali(localDate(point.date));
        const lines = series.map((s) => `<div>${s.name}: ${fullNumber.format(Number(point[s.key]))} ریال (${toPersianDigits(point[s.countKey])} مورد)</div>`);
        return `<div style="font-weight:600;margin-bottom:2px">${heading}</div>${lines.join("")}`;
      },
    },
    xAxis: {
      type: "category",
      inverse: true,
      data: points.map((point) => shortJalali(point.date)),
      axisLine: { lineStyle: { color: tokens.grid } },
      axisTick: { show: false },
      axisLabel: { color: tokens.axisLabel, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      position: "right",
      splitNumber: 4,
      axisLabel: { color: tokens.axisLabel, fontSize: 11, formatter: (value: number) => compactNumber.format(value) },
      splitLine: { lineStyle: { color: tokens.grid, type: "dashed" } },
    },
    series: series.map((s) => ({
      type: "bar",
      name: s.name,
      data: points.map((point) => Number(point[s.key])),
      barMaxWidth: 16,
      itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] },
      emphasis: { itemStyle: { color: s.color, opacity: 0.85 } },
    })),
  };

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      style={{ height: 288, width: "100%" }}
      opts={{ renderer: "canvas" }}
      aria-label="نمودار روند روزانهٔ فروش"
    />
  );
}
