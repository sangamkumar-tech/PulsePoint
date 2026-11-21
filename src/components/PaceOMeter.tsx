import { PaceAssessment } from "../utils/roomUtils";

interface PaceOMeterProps {
  assessment: PaceAssessment;
}

export function PaceOMeter({ assessment }: PaceOMeterProps) {
  const { score, status, tone, summary } = assessment;
  // Map 0..100 score to -90deg .. +90deg needle rotation
  const angleDeg = -90 + (Math.max(0, Math.min(100, score)) / 100) * 180;

  const badgeTone =
    tone === "rose"
      ? "text-rose-400"
      : tone === "amber"
      ? "text-amber-400"
      : "text-emerald-400";

  const needleColor =
    tone === "rose" ? "#f43f5e" : tone === "amber" ? "#f59e0b" : "#10b981";

  return (
    <div className="pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold text-slate-100">
            Live Pace-o-Meter
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Driven by Too Fast, Need Example &amp; Missed Step tags
          </p>
        </div>
        <span className={`text-xs font-bold whitespace-nowrap ${badgeTone}`}>
          {status}
        </span>
      </div>

      {/* Semicircular Speedometer Gauge */}
      <div className="flex flex-col items-center justify-center pt-1">
        <svg
          viewBox="0 0 200 115"
          className="w-full max-w-[230px] overflow-visible"
          role="img"
          aria-label={`Classroom pace gauge: ${status}`}
        >
          {/* Green zone: Optimal Pace (0 - 33%) */}
          <path
            d="M 20 98 A 80 80 0 0 1 60 28.7"
            fill="none"
            stroke="rgba(16, 185, 129, 0.35)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Amber zone: Slow Down / Give Example (34 - 66%) */}
          <path
            d="M 65 26 A 80 80 0 0 1 135 26"
            fill="none"
            stroke="rgba(245, 158, 11, 0.4)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Rose zone: Stop & Recap (67 - 100%) */}
          <path
            d="M 140 28.7 A 80 80 0 0 1 180 98"
            fill="none"
            stroke="rgba(244, 63, 94, 0.45)"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* Active highlight arc up to needle */}
          <g
            transform={`rotate(${angleDeg} 100 98)`}
            style={{
              transition: "transform 450ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <line
              x1="100"
              y1="98"
              x2="100"
              y2="30"
              stroke={needleColor}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle cx="100" cy="30" r="3.5" fill={needleColor} />
          </g>

          <circle
            cx="100"
            cy="98"
            r="7"
            fill="#0f172a"
            stroke={needleColor}
            strokeWidth="3"
          />

          <text
            x="18"
            y="113"
            fill="#10b981"
            fontSize="9"
            fontFamily="DM Sans, sans-serif"
            fontWeight="600"
          >
            Optimal
          </text>
          <text
            x="100"
            y="14"
            textAnchor="middle"
            fill="#f59e0b"
            fontSize="9"
            fontFamily="DM Sans, sans-serif"
            fontWeight="600"
          >
            Slow Down
          </text>
          <text
            x="182"
            y="113"
            textAnchor="end"
            fill="#f43f5e"
            fontSize="9"
            fontFamily="DM Sans, sans-serif"
            fontWeight="600"
          >
            Recap
          </text>
        </svg>

        <div className="text-center mt-1">
          <div className={`font-display text-sm font-bold ${badgeTone}`}>
            {status}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            {summary}
          </div>
        </div>
      </div>
    </div>
  );
}
