export class ApiError extends Error {
  status: number;
  code?: string;
  hint?: string;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    hint?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

/** True when Supabase is linked but tables have not been pushed yet. */
export function isSetupRequiredError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err instanceof ApiError && err.code === "SETUP_REQUIRED") return true;
  const m = err.message.toLowerCase();
  return (
    m.includes("push to supabase") ||
    m.includes("schema cache") ||
    m.includes("tables are not set up") ||
    m.includes("could not find the table")
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const obj =
      data && typeof data === "object" && data !== null
        ? (data as { error?: unknown; code?: unknown })
        : null;
    const err =
      obj && "error" in obj && obj.error != null
        ? String(obj.error)
        : `Request failed (${res.status})`;
    const code =
      obj && typeof obj.code === "string" ? obj.code : undefined;
    throw new ApiError(err, res.status, code);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export type Consumable = {
  id: number;
  name: string;
  sku: string;
  description: string;
  quantity: number;
  min_level: number;
  unit: string;
  category: string;
  bin_location: string;
  asset_tag: string;
  notes: string;
  is_active: boolean;
  updated_at: string | null;
  created_at: string | null;
};

export type StockTransaction = {
  id: number;
  consumable_id: number;
  change_amount: number;
  previous_quantity: number;
  new_quantity: number;
  reason: string;
  note: string;
  created_by: string;
  created_at: string | null;
};

export type BinLocation = {
  id: number;
  code: string;
  name: string;
  zone: string;
  aisle: string;
  shelf: string;
  description: string;
  asset_tag: string;
  is_active: boolean;
  updated_at: string | null;
  created_at: string | null;
};

export type PrinterSetting = {
  id: number;
  name: string;
  host: string;
  port: number;
  protocol: string;
  label_width_mm: number;
  label_height_mm: number;
  dpi: number;
  is_default: boolean;
  notes: string;
  created_at: string | null;
};

export type DashboardStats = {
  total_items: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_bins: number;
  recent_transactions: Array<
    StockTransaction & { consumable_name?: string; consumable_sku?: string }
  >;
};
