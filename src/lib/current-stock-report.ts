import { downloadText } from "@/lib/download";

/** Item fields used to build the current-stock export. */
export type CurrentStockReportItem = {
  name: string;
  sku?: string | null;
  mpn?: string | null;
  asset_tag?: string | null;
  bin_location?: string | null;
  category?: string | null;
  unit?: string | null;
  quantity: number;
  min_level: number;
  /** Outstanding ordered units not yet received; null means unavailable. */
  quantity_on_order?: number | null;
  /** Optional status from the live consumables-alerts endpoint. */
  stock_status?: string | null;
  updated_at?: string | null;
  is_active?: boolean;
};

export type CurrentStockReportRow = CurrentStockReportItem & {
  quantity: number;
  min_level: number;
  quantity_on_order: number | null;
  unit: string;
  stock_status: string;
};

function csvEscape(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function stamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function stockStatus(item: CurrentStockReportItem, quantity: number, minimum: number): string {
  const status = String(item.stock_status ?? "");
  if (status === "out_of_stock") return "Out of stock";
  if (status === "below_minimum") return "Below minimum";
  if (status === "approaching") return "Approaching minimum";
  if (status === "good") return "Good";
  if (quantity <= 0) return "Out of stock";
  if (quantity <= minimum) return "Below minimum";
  return "Good";
}

export function buildCurrentStockRows(
  items: CurrentStockReportItem[],
): CurrentStockReportRow[] {
  return items
    .filter((item) => item.is_active !== false)
    .map((item) => {
      const quantity = Math.max(0, Math.trunc(Number(item.quantity) || 0));
      const min_level = Math.max(0, Math.trunc(Number(item.min_level) || 0));
      const incoming =
        item.quantity_on_order == null
          ? null
          : Math.max(0, Math.trunc(Number(item.quantity_on_order) || 0));
      return {
        ...item,
        quantity,
        min_level,
        quantity_on_order: incoming,
        unit: item.unit || "ea",
        stock_status: stockStatus(item, quantity, min_level),
      };
    })
    .sort((a, b) => {
      const categoryOrder = (a.category || "").localeCompare(b.category || "");
      return categoryOrder || a.name.localeCompare(b.name);
    });
}

/** Build a CSV of every active consumable's current on-hand stock. */
export function buildCurrentStockReportCsv(items: CurrentStockReportItem[]): {
  csv: string;
  rows: CurrentStockReportRow[];
} {
  const rows = buildCurrentStockRows(items);
  const headers = [
    "Name",
    "SKU",
    "MPN",
    "Asset Tag",
    "Category",
    "Bin",
    "Unit",
    "On Hand",
    "On Order (Not Received)",
    "Minimum",
    "Stock Status",
    "Last Updated",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((item) =>
      [
        item.name,
        item.sku ?? "",
        item.mpn ?? "",
        item.asset_tag ?? "",
        item.category ?? "",
        item.bin_location ?? "",
        item.unit,
        item.quantity,
        item.quantity_on_order,
        item.min_level,
        item.stock_status,
        item.updated_at ?? "",
      ]
        .map(csvEscape)
        .join(","),
    ),
    "",
    "# On Hand is physical stock; On Order lists outstanding units not yet received.",
    `# Generated ${new Date().toISOString()}`,
  ];

  return { csv: `${lines.join("\r\n")}\r\n`, rows };
}

export function downloadCurrentStockReport(items: CurrentStockReportItem[]): {
  count: number;
  filename: string;
} {
  const { csv, rows } = buildCurrentStockReportCsv(items);
  const filename = `current-stock-report-${stamp()}.csv`;
  downloadText(`\uFEFF${csv}`, filename, "text/csv;charset=utf-8");
  return { count: rows.length, filename };
}
