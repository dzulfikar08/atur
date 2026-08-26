import type { WorkspaceStrategy } from "@/lib/api";

// Verdict → dot color (tailwind palette hexes; design tokens stay for chrome).
const VERDICT_COLORS: Record<string, string> = {
  invest: "#10b981", // emerald
  harden: "#f59e0b", // amber
  harvest: "#3b82f6", // blue
  kill: "#ef4444", // red
  "needs-review": "#71717a", // zinc
};
const UNSCORED_COLOR = "#a1a1aa";

interface Props {
  workspaces: WorkspaceStrategy[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// Hand-rolled SVG 2×2 scatter — Moat (Y) × AI-proof (X), 0–5 each. No chart
// lib (Kumo lesson): plain coordinates, quadrant split at 2.5.
export default function StrategyScatter({ workspaces, selectedId, onSelect }: Props) {
  const W = 480;
  const H = 400;
  const M = { top: 28, right: 20, bottom: 40, left: 44 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const midX = M.left + pw / 2;
  const midY = M.top + ph / 2;

  const x = (v: number) => M.left + (v / 5) * pw;
  const y = (v: number) => M.top + ph - (v / 5) * ph;

  const plotted = workspaces.filter(
    (w) => w.moat_score != null && w.ai_proof_score != null,
  ) as (WorkspaceStrategy & { moat_score: number; ai_proof_score: number })[];

  // Spread dots that share a cell slightly so they don't fully overlap.
  const offsets = new Map<string, number>();
  for (const w of plotted) {
    const key = `${w.moat_score}:${w.ai_proof_score}`;
    const n = offsets.get(key) ?? 0;
    offsets.set(key, n + 1);
  }
  const seen = new Map<string, number>();

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Moat × AI-proof portfolio matrix"
    >
      {/* Quadrant backgrounds */}
      <rect x={M.left} y={M.top} width={pw / 2} height={ph / 2} fill="#f59e0b" opacity={0.05} />
      <rect x={midX} y={M.top} width={pw / 2} height={ph / 2} fill="#10b981" opacity={0.05} />
      <rect x={M.left} y={midY} width={pw / 2} height={ph / 2} fill="#ef4444" opacity={0.05} />
      <rect x={midX} y={midY} width={pw / 2} height={ph / 2} fill="#3b82f6" opacity={0.05} />

      {/* Grid + split lines */}
      {[0, 1, 2, 3, 4, 5].map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            y1={M.top}
            x2={x(t)}
            y2={M.top + ph}
            stroke="currentColor"
            className="text-border"
            strokeWidth={t === 0 ? 1 : 0.5}
          />
          <line
            x1={M.left}
            y1={y(t)}
            x2={M.left + pw}
            y2={y(t)}
            stroke="currentColor"
            className="text-border"
            strokeWidth={t === 0 ? 1 : 0.5}
          />
          <text
            x={x(t)}
            y={H - M.bottom + 16}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {t}
          </text>
          <text
            x={M.left - 10}
            y={y(t) + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {t}
          </text>
        </g>
      ))}
      <line
        x1={midX}
        y1={M.top}
        x2={midX}
        y2={M.top + ph}
        stroke="currentColor"
        className="text-border"
        strokeDasharray="4 3"
      />
      <line
        x1={M.left}
        y1={midY}
        x2={M.left + pw}
        y2={midY}
        stroke="currentColor"
        className="text-border"
        strokeDasharray="4 3"
      />

      {/* Quadrant labels */}
      <text
        x={M.left + 8}
        y={M.top + 14}
        fontSize={10}
        fontWeight={600}
        className="fill-foreground/70"
      >
        HARDEN
      </text>
      <text
        x={W - M.right - 8}
        y={M.top + 14}
        fontSize={10}
        fontWeight={600}
        textAnchor="end"
        className="fill-foreground/70"
      >
        INVEST
      </text>
      <text
        x={M.left + 8}
        y={M.top + ph - 8}
        fontSize={10}
        fontWeight={600}
        className="fill-foreground/70"
      >
        KILL
      </text>
      <text
        x={W - M.right - 8}
        y={M.top + ph - 8}
        fontSize={10}
        fontWeight={600}
        textAnchor="end"
        className="fill-foreground/70"
      >
        HARVEST
      </text>

      {/* Axis titles */}
      <text x={midX} y={H - 6} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
        AI-proof →
      </text>
      <text
        x={12}
        y={midY}
        fontSize={10}
        className="fill-muted-foreground"
        transform={`rotate(-90 12 ${midY})`}
        textAnchor="middle"
      >
        ← Moat
      </text>

      {/* Dots */}
      {plotted.map((w) => {
        const key = `${w.moat_score}:${w.ai_proof_score}`;
        const i = seen.get(key) ?? 0;
        seen.set(key, i + 1);
        const n = offsets.get(key) ?? 1;
        const spread = n > 1 ? (i - (n - 1) / 2) * 9 : 0;
        const cx = x(w.ai_proof_score) + spread;
        const cy = y(w.moat_score) - spread;
        const color =
          w.strategy_verdict != null
            ? (VERDICT_COLORS[w.strategy_verdict] ?? UNSCORED_COLOR)
            : UNSCORED_COLOR;
        const selected = w.id === selectedId;
        return (
          <g key={w.id} onClick={() => onSelect(w.id)} className="cursor-pointer">
            <title>{`${w.name} — Moat ${w.moat_score} · AI-proof ${w.ai_proof_score}${
              w.strategy_note ? `\n${w.strategy_note}` : ""
            }`}</title>
            {selected && (
              <circle cx={cx} cy={cy} r={11} fill="none" stroke={color} strokeWidth={1.5} />
            )}
            <circle
              cx={cx}
              cy={cy}
              r={selected ? 7 : 5.5}
              fill={color}
              fillOpacity={0.85}
              stroke="white"
              strokeWidth={1}
            />
            <text
              x={cx}
              y={cy + 15}
              textAnchor="middle"
              fontSize={9}
              className="fill-foreground/80"
            >
              {w.name.length > 14 ? `${w.name.slice(0, 13)}…` : w.name}
            </text>
          </g>
        );
      })}

      {plotted.length === 0 && (
        <text
          x={W / 2}
          y={H / 2}
          textAnchor="middle"
          fontSize={12}
          className="fill-muted-foreground"
        >
          No workspaces scored yet — pick one below and set Moat + AI-proof.
        </text>
      )}
    </svg>
  );
}
