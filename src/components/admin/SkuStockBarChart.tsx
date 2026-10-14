import { cn } from "@/lib/utils";
import type { ConsumablesAlertSkuRow } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = {
  out_of_stock: "Out",
  below_minimum: "Below min",
  approaching: "Approaching",
  good: "Good",
};

const STATUS_BAR: Record<string, string> = {
  out_of_stock: "bg-destructive",
  below_minimum: "bg-amber-500",
  approaching: "bg-sky-500",
  good: "bg-emerald-500",
};

/**
 * Compact horizontal bar: on-hand vs min marker and approaching band.
 */
export function SkuStockBarChart({
  item,
  className,
}: {
  item: ConsumablesAlertSkuRow;
  className?: string;
}) {
  const qty = Math.max(0, Number(item.quantity) || 0);
  const min = Math.max(0, Number(item.min_level) || 0);
  const approach = Math.max(
    min,
    Number(item.approaching_ceiling) || min * (item.approaching_ratio || 1.25),
  );
  const scale = Math.max(qty, approach, min, 1) * 1.15;
  const qtyPct = Math.min(100, (qty / scale) * 100);
  const minPct = Math.min(100, (min / scale) * 100);
  const approachPct = Math.min(100, (approach / scale) * 100);
  const status = String(item.status || "good");
  const barClass = STATUS_BAR[status] ?? STATUS_BAR.good;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/80 bg-card px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {item.sku || "—"}
            {item.bin_location ? ` · ${item.bin_location}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            status === "out_of_stock" &&
              "bg-destructive/10 text-destructive",
            status === "below_minimum" &&
              "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            status === "approaching" &&
              "bg-sky-500/10 text-sky-700 dark:text-sky-400",
            status === "good" &&
              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      <div className="relative mt-2.5 h-3 w-full overflow-hidden rounded-sm bg-muted">
        {/* Approaching band from min → approach ceiling */}
        {approach > min ? (
          <div
            className="absolute inset-y-0 bg-sky-500/15"
            style={{
              left: `${minPct}%`,
              width: `${Math.max(0, approachPct - minPct)}%`,
            }}
            title={`Approaching band ≤ ${approach}`}
          />
        ) : null}
        {/* On-hand fill */}
        <div
          className={cn("absolute inset-y-0 left-0 rounded-sm", barClass)}
          style={{ width: `${qtyPct}%` }}
          title={`${qty} on hand`}
        />
        {/* Min marker */}
        <div
          className="absolute inset-y-0 w-px bg-foreground/70"
          style={{ left: `${minPct}%` }}
          title={`Min ${min}`}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
        <span>
          {qty} {item.unit || "ea"} on hand · min {min}
        </span>
        {(Number(item.qty_to_order) || 0) > 0 ? (
          <span className="font-medium text-foreground">
            Order {item.qty_to_order} → {item.restock_target ?? min * 2}
          </span>
        ) : (
          <span>OK</span>
        )}
      </div>
    </div>
  );
}
