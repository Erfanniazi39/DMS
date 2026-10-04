"use client";

// Purchases trend bar chart for the admin dashboard. Not a route — only
// page.tsx's sibling, loaded from there via next/dynamic with ssr: false
// (echarts measures and draws into a real DOM canvas).
//
// Only the echarts pieces actually used are registered (core + bar +
// grid/tooltip + canvas), instead of the full "echarts" bundle.

import { useEffect, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { JALALI_MONTH_NAMES, formatJalali, toJalali, toPersianDigits } from "@/lib/jalali";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export type TrendPoint = { date: string; amount: string; count: number };

type ChartTokens = {
  bar: string;
  grid: string;
  axisLabel: string;
  tooltipBg: string;
  tooltipFg: string;
  tooltipBorder: string;
  fontFamily: string;
};

// Colors come from the app's own tokens in app/globals.css — never
// hard-coded here — and are re-read if the <html> class changes, so the
// chart follows the .dark token set once dark mode is switched on.
function readTokens(): ChartTokens {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  return {
    bar: token("--chart-1"),
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

// "YYYY-MM-DD" is read as a local calendar date — same as JalaliDateInput.
function localDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`);
}

function shortJalali(isoDate: string) {
  const { jm, jd } = toJalali(localDate(isoDate));
  return `${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]}`;
}

const compactNumber = new Intl.NumberFormat("fa-IR", { notation: "compact", maximumFractionDigits: 1 });
const fullNumber = new Intl.NumberFormat("fa-IR");

export default function PurchaseTrendChart({ points, bucket }: { points: TrendPoint[]; bucket: "day" | "week" }) {
  const tokens = useChartTokens();

  const option = {
    textStyle: { fontFamily: tokens.fontFamily },
    animationDuration: 300,
    grid: { top: 12, bottom: 4, left: 8, right: 8, containLabel: true },
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
        return `<div style="font-weight:600;margin-bottom:2px">${heading}</div>`
          + `<div>مبلغ: ${fullNumber.format(Number(point.amount))} ریال</div>`
          + `<div>تعداد: ${toPersianDigits(point.count)} خرید</div>`;
      },
    },
    xAxis: {
      type: "category",
      // RTL: time runs right-to-left, matching the reading direction.
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
    series: [
      {
        type: "bar",
        name: "مبلغ خرید",
        data: points.map((point) => Number(point.amount)),
        barMaxWidth: 22,
        itemStyle: { color: tokens.bar, borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: tokens.bar, opacity: 0.85 } },
      },
    ],
  };

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      style={{ height: 256, width: "100%" }}
      opts={{ renderer: "canvas" }}
      aria-label="نمودار مبلغ خرید در بازه انتخاب‌شده"
    />
  );
}
