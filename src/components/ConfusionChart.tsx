import { useEffect, useMemo, useRef } from "react";
import Chart, { Plugin } from "chart.js/auto";
import { TimelinePoint } from "../types";
import { formatMinuteLabel, getMinuteBucketMs } from "../utils/roomUtils";

interface ConfusionChartProps {
  points: TimelinePoint[];
  showTopicDividers?: boolean;
  printFriendly?: boolean;
  emptyText?: string;
}

export function ConfusionChart({
  points,
  showTopicDividers = false,
  printFriendly = false,
  emptyText,
}: ConfusionChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  // Normalize to clean 1-minute bucket intervals ordered chronologically
  const minutePoints = useMemo(() => {
    const byBucket = new Map<string, TimelinePoint>();
    for (const pt of points) {
      const bucketMs = pt.minuteBucketMs ?? getMinuteBucketMs(pt.timestampMs);
      const key = `${bucketMs}_${pt.topicVersion}`;
      const existing = byBucket.get(key);
      if (!existing || pt.timestampMs >= existing.timestampMs) {
        byBucket.set(key, {
          ...pt,
          minuteBucketMs: bucketMs,
          timeLabel: formatMinuteLabel(bucketMs),
        });
      }
    }
    return Array.from(byBucket.values()).sort(
      (a, b) => (a.minuteBucketMs ?? a.timestampMs) - (b.minuteBucketMs ?? b.timestampMs)
    );
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const labels = minutePoints.map((p) => p.timeLabel);
    const confusionData = minutePoints.map((p) => p.confusionPct);
    const thresholdData = minutePoints.map(() => 30);

    const pointRadii = minutePoints.map((p) =>
      p.isSpike || p.confusionPct > 30 ? 7 : 4
    );
    const pointColors = minutePoints.map((p) =>
      p.isSpike || p.confusionPct > 30 ? "#f43f5e" : "#38bdf8"
    );
    const pointBorders = minutePoints.map((p) =>
      p.isSpike || p.confusionPct > 30 ? "#ffffff" : "#0f172a"
    );
    const pointStyles = minutePoints.map((p) =>
      p.isSpike || p.confusionPct > 30 ? ("triangle" as const) : ("circle" as const)
    );

    const gridColor = printFriendly
      ? "rgba(148, 163, 184, 0.35)"
      : "rgba(148, 163, 184, 0.12)";
    const tickColor = printFriendly ? "#334155" : "#94a3b8";

    const topicDividerPlugin: Plugin<"line"> = {
      id: "topicDividers",
      afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const xScale = scales.x;
        if (!xScale || !chartArea) return;

        ctx.save();
        if (showTopicDividers && minutePoints.length >= 2) {
          for (let i = 1; i < minutePoints.length; i++) {
            if (minutePoints[i].topicVersion !== minutePoints[i - 1].topicVersion) {
              const x = xScale.getPixelForValue(i);
              ctx.beginPath();
              ctx.setLineDash([4, 4]);
              ctx.strokeStyle = printFriendly
                ? "rgba(100, 116, 139, 0.7)"
                : "rgba(148, 163, 184, 0.45)";
              ctx.lineWidth = 1.25;
              ctx.moveTo(x, chartArea.top);
              ctx.lineTo(x, chartArea.bottom);
              ctx.stroke();

              ctx.setLineDash([]);
              ctx.fillStyle = printFriendly ? "#1e293b" : "#cbd5e1";
              ctx.font = "600 10px 'DM Sans', system-ui, sans-serif";
              const label =
                minutePoints[i].topic.length > 18
                  ? `${minutePoints[i].topic.slice(0, 16)}…`
                  : minutePoints[i].topic;
              ctx.fillText(
                label,
                Math.min(x + 5, chartArea.right - 95),
                chartArea.top + 12
              );
            }
          }
        }

        // Annotate peak spike point on chart
        for (let i = 0; i < minutePoints.length; i++) {
          const pt = minutePoints[i];
          if (pt.isSpike || pt.confusionPct > 30) {
            const meta = chart.getDatasetMeta(0);
            const el = meta?.data?.[i];
            if (el) {
              ctx.fillStyle = "#fb7185";
              ctx.font = "700 10px 'DM Sans', system-ui, sans-serif";
              ctx.textAlign = "center";
              ctx.fillText(
                `⚠ ${pt.confusionPct}%`,
                el.x,
                Math.max(chartArea.top + 12, el.y - 12)
              );
            }
          }
        }

        ctx.restore();
      },
    };

    chartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Confusion % (1-Min Interval)",
            data: confusionData,
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.14)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.28,
            pointRadius: pointRadii,
            pointHoverRadius: 8,
            pointStyle: pointStyles,
            pointBackgroundColor: pointColors,
            pointBorderColor: pointBorders,
            pointBorderWidth: 2,
          },
          {
            label: "30% Spike Threshold",
            data: thresholdData,
            borderColor: "rgba(244, 63, 94, 0.8)",
            borderWidth: 1.5,
            borderDash: [6, 6],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      plugins: [topicDividerPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 180 },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              color: tickColor,
              boxWidth: 12,
              usePointStyle: true,
              font: {
                family: "DM Sans, system-ui, sans-serif",
                size: 11,
              },
            },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            titleColor: "#f8fafc",
            bodyColor: "#cbd5e1",
            borderColor: "rgba(51, 65, 85, 0.9)",
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex ?? 0;
                const pt = minutePoints[idx];
                if (!pt) return "";
                const sub = pt.subheading ? ` · ${pt.subheading}` : "";
                return `${pt.timeLabel} · ${pt.topic}${sub}`;
              },
              label: (ctx) => {
                if (ctx.datasetIndex === 1) {
                  return "Spike Alert Threshold: 30%";
                }
                const pt = minutePoints[ctx.dataIndex];
                if (!pt) return `${ctx.parsed.y}%`;
                const spikeTag =
                  pt.isSpike || pt.confusionPct > 30
                    ? " ⚠️ Confusion Spike"
                    : "";
                const reasonTag = pt.topReason ? ` · Top: ${pt.topReason}` : "";
                return `Confusion: ${pt.confusionPct}% (${pt.confusedCount}/${pt.totalParticipants})${spikeTag}${reasonTag}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10,
              font: {
                family: "JetBrains Mono, monospace",
                size: 11,
              },
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
              font: {
                family: "JetBrains Mono, monospace",
                size: 11,
              },
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
  }, [minutePoints, showTopicDividers, printFriendly]);

  if (minutePoints.length === 0) {
    return (
      <div className="h-[260px] sm:h-[300px] flex flex-col items-center justify-center text-center px-6 border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
        <p className="text-sm font-medium text-slate-300">
          {emptyText || "Waiting for topic broadcast & student pulse telemetry..."}
        </p>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          The timeline plots 1-minute intervals in real time and flags any
          minute crossing 30% confusion as a spike.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[260px] sm:h-[300px] w-full">
      <canvas ref={canvasRef} data-chart-role="confusion-timeline" />
    </div>
  );
}
