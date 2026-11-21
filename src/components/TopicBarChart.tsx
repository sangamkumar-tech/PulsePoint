import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { TopicSummary } from "../types";

interface TopicBarChartProps {
  topics: TopicSummary[];
  printFriendly?: boolean;
}

export function TopicBarChart({
  topics,
  printFriendly = false,
}: TopicBarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const labels = topics.map((t) =>
      t.topic.length > 26 ? `${t.topic.slice(0, 24)}…` : t.topic
    );

    const peakColors = topics.map((t) => {
      if (t.peakConfusionPct > 30) return "rgba(244, 63, 94, 0.85)";
      if (t.peakConfusionPct >= 15) return "rgba(245, 158, 11, 0.85)";
      return "rgba(16, 185, 129, 0.85)";
    });

    const avgColors = topics.map((t) => {
      if (t.avgConfusionPct > 30) return "rgba(244, 63, 94, 0.42)";
      if (t.avgConfusionPct >= 15) return "rgba(245, 158, 11, 0.42)";
      return "rgba(16, 185, 129, 0.42)";
    });

    const tickColor = printFriendly ? "#475569" : "#94a3b8";
    const gridColor = printFriendly
      ? "rgba(148, 163, 184, 0.28)"
      : "rgba(148, 163, 184, 0.12)";

    chartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Peak Confusion %",
            data: topics.map((t) => t.peakConfusionPct),
            backgroundColor: peakColors,
            borderRadius: 6,
            barPercentage: 0.72,
          },
          {
            label: "Average Confusion %",
            data: topics.map((t) => t.avgConfusionPct),
            backgroundColor: avgColors,
            borderRadius: 6,
            barPercentage: 0.72,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              color: tickColor,
              boxWidth: 12,
              font: { family: "DM Sans, system-ui, sans-serif", size: 11 },
            },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            titleColor: "#f8fafc",
            bodyColor: "#cbd5e1",
            borderColor: "rgba(51, 65, 85, 0.9)",
            borderWidth: 1,
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex ?? 0;
                return topics[idx]?.topic ?? "";
              },
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { family: "DM Sans, system-ui, sans-serif", size: 11 },
            },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              stepSize: 20,
              callback: (v) => `${v}%`,
              font: { family: "JetBrains Mono, monospace", size: 11 },
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [topics, printFriendly]);

  if (topics.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center border border-dashed border-slate-800 rounded-xl text-xs text-slate-500">
        No topics recorded for comparison.
      </div>
    );
  }

  return (
    <div className="h-[270px] sm:h-[300px] w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
