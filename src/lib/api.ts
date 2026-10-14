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
    m.includes("could not find the table") ||
    m.includes("table is missing") ||
    (m.includes("stock_orders") && m.includes("missing"))
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
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
        ? (data as {
            error?: unknown;
            code?: unknown;
            hint?: unknown;
            consumable?: unknown;
            scanned?: unknown;
          })
        : null;
    const err =
      obj && "error" in obj && obj.error != null
        ? String(obj.error)
        : `Request failed (${res.status})`;
    const code =
      obj && typeof obj.code === "string" ? obj.code : undefined;
    const hint =
      obj && typeof obj.hint === "string" ? obj.hint : undefined;
    const details: Record<string, unknown> = {};
    if (obj && "consumable" in obj) details.consumable = obj.consumable;
    if (obj && "scanned" in obj) details.scanned = obj.scanned;
    throw new ApiError(
      err,
      res.status,
      code,
      hint,
      Object.keys(details).length ? details : undefined,
    );
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

/** Purchase / replenishment order for a consumable. */
export type StockOrder = {
  id: number;
  consumable_id: number;
  quantity_ordered: number;
  quantity_received: number | null;
  status: "ordered" | "delivered" | "cancelled" | string;
  note: string;
  ordered_by: string;
  received_by: string;
  ordered_at: string | null;
  delivered_at: string | null;
  created_at: string | null;
  /** Populated on list/dashboard responses when available. */
  consumable_name?: string;
  consumable_sku?: string;
  consumable_unit?: string;
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
  pending_orders_count?: number;
  pending_orders?: StockOrder[];
  recent_transactions: Array<
    StockTransaction & { consumable_name?: string; consumable_sku?: string }
  >;
};

export type ApprovedEmail = {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  created_by: string;
  notes: string;
  created_at: string | null;
};

export type ScanResult = {
  ok: boolean;
  consumable: Consumable;
  transaction?: StockTransaction;
  low_stock: boolean;
  out_of_stock: boolean;
  scanned: string;
  previous_quantity?: number;
  new_quantity?: number;
  /** Actual amount subtracted (may be capped by on-hand stock). */
  amount?: number;
  requested_amount?: number;
  capped?: boolean;
  dry_run?: boolean;
};

/** Single warehouse procurement order line for the Denver day. */
export type ProcurementOrderLine = {
  id: number;
  day_key: string;
  link: string;
  quantity: number;
  notes: string;
  created_by_email: string;
  created_by_name: string;
  status: "open" | "submitted" | string;
  batch_id: number | null;
  submitted_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export type ProcurementBatch = {
  id: number;
  day_key: string;
  status: "submitted" | "empty_skipped" | string;
  line_count: number;
  jira_issue_key: string;
  jira_issue_url: string;
  slack_channel_id: string;
  slack_message_ts: string;
  dry_run: boolean;
  error_message: string;
  created_at: string | null;
  submitted_at: string | null;
};

export type ProcurementSettings = {
  id: number;
  jira_summary_template: string;
  jira_description_template: string;
  slack_channel_id: string;
  slack_ping_user_id: string;
  jira_project_key: string;
  jira_issue_type: string;
  updated_by: string;
  updated_at: string | null;
  created_at: string | null;
  resolved?: {
    slackChannelId: string;
    slackPingUserId: string;
    jiraProjectKey: string;
    jiraIssueType: string;
    close_schedule: string;
    day_key: string;
    past_close: boolean;
    jira: { configured: boolean; missing: string[]; dryRun: boolean };
    slack: { configured: boolean; missing: string[]; dryRun: boolean };
  };
};

export type ProcurementStatus = {
  day_key: string;
  /** Day that new/open lines target (tomorrow when today is locked). */
  queue_day_key: string;
  past_close: boolean;
  close_schedule: string;
  locked: boolean;
  batch: ProcurementBatch | null;
  /** Recent close batches (newest first). */
  history?: ProcurementBatch[];
  open_count: number;
  submitted_count: number;
  integrations: {
    jira: {
      configured: boolean;
      missing: string[];
      dryRun: boolean;
      warnings?: string[];
      tokenLooksValid?: boolean;
    };
    slack: {
      configured: boolean;
      missing: string[];
      dryRun: boolean;
      warnings?: string[];
      tokenLooksValid?: boolean;
    };
    dry_run: boolean;
    dry_run_reason?: string;
    env_dry_run?: boolean;
    missing_live?: string[];
    mode?: "dry-run" | "live" | string;
  };
};

export type ProcurementCloseResult = {
  ok: boolean;
  skipped: boolean;
  reason: string;
  dayKey: string;
  batch?: ProcurementBatch;
  lineCount?: number;
  dryRun?: boolean;
  dryRunReason?: string;
  mode?: "dry-run" | "live" | string;
  slackPosted?: boolean;
  message?: string;
  issue?: { key: string; url: string; dryRun: boolean };
  slack?: { channel: string; ts: string; dryRun: boolean };
};

/** Result of Admin → Integrations probe (auth or write). */
export type IntegrationTestResult = {
  ok: boolean;
  mode: "auth" | "write" | string;
  dry_run: boolean;
  dry_run_reason?: string;
  message?: string;
  integrations?: ProcurementStatus["integrations"];
  slack?: {
    ok: boolean;
    dry_run?: boolean;
    step?: string;
    detail?: string;
    error?: string;
    auth?: {
      team?: string;
      user?: string;
      bot_id?: string | null;
    };
    post?: { channel: string; ts: string; dryRun: boolean };
  } | null;
  jira?: {
    ok: boolean;
    dry_run?: boolean;
    step?: string;
    detail?: string;
    error?: string;
    auth?: {
      accountId?: string;
      displayName?: string;
      emailAddress?: string | null;
    };
    issue?: { key: string; url: string; dryRun: boolean };
  } | null;
};

export type ConsumablesAlertBatch = {
  id: number;
  week_key: string;
  status: "submitted" | "empty_skipped" | string;
  item_count: number;
  out_of_stock_count: number;
  below_minimum_count: number;
  approaching_count: number;
  good_count: number;
  jira_issue_key: string;
  jira_issue_url: string;
  slack_channel_id: string;
  slack_message_ts: string;
  dry_run: boolean;
  error_message: string;
  created_at: string | null;
  submitted_at: string | null;
};

export type ConsumablesAlertCounts = {
  out_of_stock: number;
  below_minimum: number;
  approaching: number;
  good: number;
  total: number;
  /** Units to order to reach restock target (min × 2). */
  units_to_order?: number;
  /** SKUs with qty_to_order > 0. */
  skus_to_order?: number;
};

export type ConsumablesAlertsIntegrations = {
  jira: {
    configured: boolean;
    missing: string[];
    dryRun: boolean;
    warnings?: string[];
    tokenLooksValid?: boolean;
  };
  slack: {
    configured: boolean;
    missing: string[];
    dryRun: boolean;
    warnings?: string[];
    tokenLooksValid?: boolean;
  };
  dry_run: boolean;
  dry_run_reason?: string;
  env_dry_run?: boolean;
  missing_live?: string[];
  mode?: "dry-run" | "live" | string;
  routing?: {
    slackChannelId: string | null;
    slackPingUserId: string | null;
    jiraProjectKey: string | null;
    jiraIssueType: string;
  };
};

export type ConsumablesAlertSettings = {
  id: number;
  approaching_ratio: number;
  weekly_enabled: boolean;
  include_out_of_stock: boolean;
  include_below_minimum: boolean;
  include_approaching: boolean;
  include_good: boolean;
  /** ISO weekday 1=Monday … 7=Sunday */
  schedule_weekday: number;
  schedule_hour_mst: number;
  slack_channel_id: string;
  slack_ping_user_id: string;
  jira_project_key: string;
  jira_issue_type: string;
  jira_summary_template?: string;
  jira_intro_template?: string;
  jira_section_heading_template?: string;
  jira_item_line_template?: string;
  jira_empty_section_template?: string;
  jira_footer_template?: string;
  /** Layout composing {{intro}}, {{sections}}, {{footer}}. */
  jira_description_template?: string;
  updated_by: string;
  updated_at: string | null;
  created_at: string | null;
  schedule?: string;
  resolved?: {
    slackChannelId: string;
    slackPingUserId: string;
    jiraProjectKey: string;
    jiraIssueType: string;
    dryRunEnv: boolean;
    schedule?: string;
  };
};

export type ConsumablesAlertSkuRow = {
  id: number;
  name: string;
  sku: string;
  quantity: number;
  min_level: number;
  unit: string;
  bin_location: string;
  category: string;
  status: "out_of_stock" | "below_minimum" | "approaching" | "good" | string;
  approaching_ceiling: number;
  approaching_ratio: number;
  /** Restock fill target (min × 2). */
  restock_target?: number;
  /** Units already ordered and not yet received. */
  quantity_on_order?: number;
  /** Units to order to reach restock target. */
  qty_to_order?: number;
};

export type ConsumablesAlertsStatus = {
  week_key: string;
  day_key: string;
  schedule: string;
  locked: boolean;
  batch: ConsumablesAlertBatch | null;
  /** Recent weekly alert batches (newest first). */
  history?: ConsumablesAlertBatch[];
  counts: ConsumablesAlertCounts;
  items?: ConsumablesAlertSkuRow[];
  settings?: ConsumablesAlertSettings;
  integrations: ConsumablesAlertsIntegrations;
};

export type ConsumablesAlertsRunResult = {
  ok: boolean;
  skipped: boolean;
  reason: string;
  weekKey: string;
  dayKey: string;
  batch?: ConsumablesAlertBatch;
  counts?: ConsumablesAlertCounts;
  dryRun?: boolean;
  message?: string;
  issue?: { key: string; url: string; dryRun: boolean };
  slack?: { channel: string; ts: string; dryRun: boolean };
};

/**
 * Accept only a real alerts status payload. SPA HTML / error bodies that
 * sneak through as HTTP 200 must not be treated as status.
 */
export function parseConsumablesAlertsStatus(
  data: unknown,
): ConsumablesAlertsStatus | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.week_key !== "string" || typeof o.schedule !== "string") {
    return null;
  }

  const rawCounts =
    o.counts && typeof o.counts === "object"
      ? (o.counts as Record<string, unknown>)
      : null;
  const rawIntegrations =
    o.integrations && typeof o.integrations === "object"
      ? (o.integrations as Record<string, unknown>)
      : null;
  const rawJira =
    rawIntegrations?.jira && typeof rawIntegrations.jira === "object"
      ? (rawIntegrations.jira as Record<string, unknown>)
      : null;
  const rawSlack =
    rawIntegrations?.slack && typeof rawIntegrations.slack === "object"
      ? (rawIntegrations.slack as Record<string, unknown>)
      : null;

  const rawItems = Array.isArray(o.items) ? o.items : [];
  const rawSettings =
    o.settings && typeof o.settings === "object"
      ? (o.settings as ConsumablesAlertSettings)
      : undefined;

  return {
    week_key: o.week_key,
    day_key: typeof o.day_key === "string" ? o.day_key : "",
    schedule: o.schedule,
    locked: Boolean(o.locked),
    batch:
      o.batch && typeof o.batch === "object"
        ? (o.batch as ConsumablesAlertBatch)
        : null,
    history: Array.isArray(o.history)
      ? (o.history as ConsumablesAlertBatch[])
      : [],
    counts: {
      out_of_stock: Number(rawCounts?.out_of_stock) || 0,
      below_minimum: Number(rawCounts?.below_minimum) || 0,
      approaching: Number(rawCounts?.approaching) || 0,
      good: Number(rawCounts?.good) || 0,
      total: Number(rawCounts?.total) || 0,
      units_to_order: Number(rawCounts?.units_to_order) || 0,
      skus_to_order: Number(rawCounts?.skus_to_order) || 0,
    },
    items: rawItems as ConsumablesAlertSkuRow[],
    settings: rawSettings,
    integrations: {
      jira: {
        configured: Boolean(rawJira?.configured),
        missing: Array.isArray(rawJira?.missing)
          ? rawJira.missing.map(String)
          : [],
        dryRun: Boolean(rawJira?.dryRun),
      },
      slack: {
        configured: Boolean(rawSlack?.configured),
        missing: Array.isArray(rawSlack?.missing)
          ? rawSlack.missing.map(String)
          : [],
        dryRun: Boolean(rawSlack?.dryRun),
      },
      dry_run: Boolean(rawIntegrations?.dry_run),
      ...(rawIntegrations?.routing &&
      typeof rawIntegrations.routing === "object"
        ? {
            routing:
              rawIntegrations.routing as ConsumablesAlertsIntegrations["routing"],
          }
        : {}),
    },
  };
}
