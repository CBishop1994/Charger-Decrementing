import { cn } from "@/lib/utils";

export type StockStatusCounts = {
  out_of_stock: number;
  below_minimum: number;
  approaching: number;
  good: number;
};

const SEGMENTS: Array<{
  key: keyof StockStatusCounts;
  label: string;
  color: string;
}> = [
  { key: "out_of_stock", label: "Out of stock", color: "var(--destructive, #dc2626)" },
  { key: "below_minimum", label: "Below minimum", color: "#d97706" },
  { key: "approaching", label: "Approaching", color: "#0284c7" },
  { key: "good", label: "Good", color: "#059669" },
];

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, startDeg);
  const o2 = polar(cx, cy, rOuter, endDeg);
  const i1 = polar(cx, cy, rInner, endDeg);
  const i2 = polar(cx, cy, rInner, startDeg);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i2.x} ${i2.y}`,
    "Z",
  ].join(" ");
}

/**
 * Circular donut of weekly consumables status counts.
 */
export function StockStatusDonutChart({
  counts,
  className,
}: {
  counts: StockStatusCounts;
  className?: string;
}) {
  const values = SEGMENTS.map((s) => Math.max(0, Number(counts[s.key]) || 0));
  const total = values.reduce((a, b) => a + b, 0);
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 78;
  const rInner = 48;

  let cursor = 0;
  const paths =
    total === 0
      ? []
      : SEGMENTS.map((seg, i) => {
          const v = values[i];
          if (v <= 0) return null;
          const sweep = (v / total) * 360;
          // Full circle as one path breaks arc math — use near-full when alone
          const start = cursor;
          const end = cursor + Math.min(sweep, 359.999);
          cursor += sweep;
          return (
            <path
              key={seg.key}
              d={arcPath(cx, cy, rOuter, rInner, start, end)}
              fill={seg.color}
            />
          );
        });

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6",
        className,
      )}
    >
      <div className="relative shrink-0">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Weekly stock status chart"
        >
          {total === 0 ? (
            <circle
              cx={cx}
              cy={cy}
              r={(rOuter + rInner) / 2}
              fill="none"
              stroke="currentColor"
              strokeWidth={rOuter - rInner}
              className="text-muted"
              opacity={0.35}
            />
          ) : (
            paths
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{total}</span>
          <span className="text-[11px] text-muted-foreground">SKUs</span>
        </div>
      </div>
      <ul className="grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {SEGMENTS.map((seg, i) => (
          <li key={seg.key} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: seg.color }}
            />
            <span className="min-w-0 truncate text-muted-foreground">
              {seg.label}
            </span>
            <span className="ml-auto font-medium tabular-nums">
              {values[i]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
