import { downloadText } from "@/lib/download";

/** Minimal shape needed to build a restock report row. */
export type RestockReportItem = {
  name: string;
  sku?: string | null;
  asset_tag?: string | null;
  bin_location?: string | null;
  category?: string | null;
  unit?: string | null;
  quantity: number;
  min_level: number;
};

export type RestockReportRow = RestockReportItem & {
  /** Target fill level = min_level × 2 */
  target_qty: number;
  /** Units to order/restock to reach target */
  qty_needed: number;
  status: "low" | "out";
};

/** Restock target is 2× the minimum level. */
export function restockTarget(minLevel: number): number {
  const min = Math.max(0, Math.trunc(Number(minLevel) || 0));
  return min * 2;
}

/**
 * Units needed to bring stock back up to 2× minimum.
 * Example: qty 7, min 10 → target 20 → need 13.
 */
export function qtyNeededToRestock(quantity: number, minLevel: number): number {
  const qty = Math.max(0, Math.trunc(Number(quantity) || 0));
  const target = restockTarget(minLevel);
  return Math.max(0, target - qty);
}

/** True when item is at/below minimum (includes out of stock). */
export function isBelowMinimum(quantity: number, minLevel: number): boolean {
  const qty = Math.max(0, Math.trunc(Number(quantity) || 0));
  const min = Math.max(0, Math.trunc(Number(minLevel) || 0));
  return qty <= min;
}

export function buildRestockRows(items: RestockReportItem[]): RestockReportRow[] {
  return items
    .filter((item) => isBelowMinimum(item.quantity, item.min_level))
    .map((item) => {
      const quantity = Math.max(0, Math.trunc(Number(item.quantity) || 0));
      const min_level = Math.max(0, Math.trunc(Number(item.min_level) || 0));
      const target_qty = restockTarget(min_level);
      const qty_needed = qtyNeededToRestock(quantity, min_level);
      return {
        ...item,
        quantity,
        min_level,
        unit: item.unit || "ea",
        target_qty,
        qty_needed,
        status: quantity <= 0 ? ("out" as const) : ("low" as const),
      };
    })
    .sort((a, b) => {
      // Out of stock first, then highest need, then name
      if (a.status !== b.status) return a.status === "out" ? -1 : 1;
      if (b.qty_needed !== a.qty_needed) return b.qty_needed - a.qty_needed;
      return a.name.localeCompare(b.name);
    });
}

function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Build a CSV restock report for items below minimum. */
export function buildRestockReportCsv(items: RestockReportItem[]): {
  csv: string;
  rows: RestockReportRow[];
  totalNeeded: number;
} {
  const rows = buildRestockRows(items);
  const headers = [
    "Name",
    "SKU",
    "Asset Tag",
    "Bin",
    "Category",
    "Unit",
    "On Hand",
    "Minimum",
    "Target (Min × 2)",
    "Qty to Restock",
    "Status",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.name,
        r.sku ?? "",
        r.asset_tag ?? "",
        r.bin_location ?? "",
        r.category ?? "",
        r.unit ?? "ea",
        r.quantity,
        r.min_level,
        r.target_qty,
        r.qty_needed,
        r.status === "out" ? "Out of stock" : "Low stock",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];

  // Summary row
  const totalNeeded = rows.reduce((sum, r) => sum + r.qty_needed, 0);
  lines.push("");
  lines.push(
    [
      "TOTAL LINES",
      rows.length,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      totalNeeded,
      "",
    ]
      .map(csvEscape)
      .join(","),
  );
  lines.push(
    `# Restock rule: target = minimum × 2; qty_to_restock = max(0, target − on_hand)`,
  );
  lines.push(`# Generated ${new Date().toISOString()}`);

  return {
    csv: lines.join("\r\n") + "\r\n",
    rows,
    totalNeeded,
  };
}

export function downloadRestockReport(items: RestockReportItem[]): {
  count: number;
  totalNeeded: number;
  filename: string;
} {
  const { csv, rows, totalNeeded } = buildRestockReportCsv(items);
  const filename = `restock-report-${stamp()}.csv`;
  // Excel-friendly UTF-8 BOM
  downloadText(`\uFEFF${csv}`, filename, "text/csv;charset=utf-8");
  return { count: rows.length, totalNeeded, filename };
}
