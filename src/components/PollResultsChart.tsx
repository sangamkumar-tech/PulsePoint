import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

interface PollResultsChartProps {
  options: string[];
  counts: number[];
  correctOptionIndex: number | null;
}

export function PollResultsChart({
  options,
  counts,
  correctOptionIndex,
}: PollResultsChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const total = counts.reduce((acc, c) => acc + c, 0);
    const barColors = options.map((_, idx) => {
      if (correctOptionIndex !== null && idx === correctOptionIndex) {
        return "rgba(16, 185, 129, 0.85)";
      }
      const palette = [
        "rgba(56, 189, 248, 0.85)",
        "rgba(245, 158, 11, 0.85)",
        "rgba(244, 63, 94, 0.85)",
        "rgba(148, 163, 184, 0.85)",
      ];
      return palette[idx % palette.length];
    });

    chartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: options.map((opt, idx) =>
          correctOptionIndex === idx ? `${opt} (Correct)` : opt
        ),
        datasets: [
          {
            label: "Votes",
            data: counts,
            backgroundColor: barColors,
            borderRadius: 8,
            barThickness: 24,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            titleColor: "#f8fafc",
            bodyColor: "#cbd5e1",
            borderColor: "rgba(51, 65, 85, 0.9)",
            borderWidth: 1,
            callbacks: {
              label: (ctx) => {
                const count = Number(ctx.parsed.x || 0);
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return `${count} ${count === 1 ? "vote" : "votes"} (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              color: "#94a3b8",
              font: { family: "JetBrains Mono, monospace", size: 11 },
            },
            grid: { color: "rgba(148, 163, 184, 0.12)" },
          },
          y: {
            ticks: {
              color: "#e2e8f0",
              font: { family: "DM Sans, system-ui, sans-serif", size: 12 },
            },
            grid: { display: false },
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
  }, [options, counts, correctOptionIndex]);

  const height = Math.max(140, options.length * 46);

  return (
    <div style={{ height: `${height}px` }} className="w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
