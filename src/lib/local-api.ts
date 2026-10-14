import { asc, desc, eq } from "drizzle-orm";
import { db, dbReady, schema } from "@/db";
import {
  buildBinLocationLabelZpl,
  buildConsumableLabelZpl,
  DEFAULT_LABEL_SIZE,
} from "@/lib/zpl";

type Row = Record<string, any>;

function normalize<T>(value: T): T {
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map((v) => normalize(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Row).map(([key, item]) => [key, normalize(item)]),
    ) as T;
  }
  return value;
}

function fail(message: string, status = 400, code?: string): never {
  const error = new Error(message) as Error & { status: number; code?: string };
  error.status = status;
  error.code = code;
  throw error;
}

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function numeric(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function now() {
  return new Date().toISOString();
}

function dateKeyInDenver(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nextDateKey(key: string) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function currentDenverWeekKey(date = new Date()) {
  const key = dateKeyInDenver(date);
  const day = new Date(`${key}T12:00:00Z`);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function localClosePassed(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((item) => item.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((item) => item.type === "minute")?.value ?? 0);
  return hour > 14 || (hour === 14 && minute >= 30);
}

function rowFromBody(init?: RequestInit): Row {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    const parsed = JSON.parse(init.body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function isPgliteApiPath(path: string) {
  return /^\/api\/(consumables|stock-orders|transactions|dashboard|bin-locations|printers|scan|procurement|consumables-alerts|print|seed|integrations\/test)(\/|\?|$)/.test(path);
}

async function getConsumable(id: number) {
  const rows = await db.select().from(schema.consumables).where(eq(schema.consumables.id, id)).limit(1);
  return rows[0] ? normalize(rows[0]) : null;
}

async function getBin(id: number) {
  const rows = await db.select().from(schema.bin_locations).where(eq(schema.bin_locations.id, id)).limit(1);
  return rows[0] ? normalize(rows[0]) : null;
}

async function getPrinter(id: number) {
  const rows = await db.select().from(schema.printer_settings).where(eq(schema.printer_settings.id, id)).limit(1);
  return rows[0] ? normalize(rows[0]) : null;
}

async function consumablesRoute(method: string, parts: string[], url: URL, body: Row) {
  const id = /^\d+$/.test(parts[1] ?? "") ? Number(parts[1]) : null;
  const action = parts[2] ?? "";
  if (action === "adjust") {
    if (method !== "POST" || !id) fail("Valid consumable id is required");
    const delta = Number(body.delta);
    if (!Number.isFinite(delta) || delta === 0) fail("Non-zero numeric delta is required");
    const item = await getConsumable(id);
    if (!item) fail("Item not found", 404);
    const previous = Number(item.quantity) || 0;
    const next = Math.max(0, previous + Math.trunc(delta));
    const updated = (await db.update(schema.consumables).set({ quantity: next, updated_at: now() }).where(eq(schema.consumables.id, id)).returning())[0];
    const transaction = (await db.insert(schema.stock_transactions).values({
      consumable_id: id,
      change_amount: next - previous,
      previous_quantity: previous,
      new_quantity: next,
      reason: text(body.reason, delta < 0 ? "use" : "restock"),
      note: text(body.note),
      created_by: text(body.created_by, "operator"),
    }).returning())[0];
    return normalize({ consumable: updated, transaction, low_stock: next > 0 && next <= Number(updated.min_level), out_of_stock: next <= 0 });
  }

  if (id) {
    if (method === "GET") {
      const item = await getConsumable(id);
      if (!item) fail("Item not found", 404);
      return item;
    }
    if (method === "PATCH") {
      const item = await getConsumable(id);
      if (!item) fail("Item not found", 404);
      const patch: Row = { updated_at: now() };
      for (const key of ["name", "sku"] as const) {
        if (body[key] !== undefined) {
          const value = text(body[key]);
          if (!value) fail(`${key === "name" ? "Name" : "SKU"} cannot be empty`);
          patch[key] = value;
        }
      }
      for (const key of ["description", "unit", "category", "bin_location", "asset_tag", "notes"] as const) {
        if (body[key] !== undefined) patch[key] = text(body[key]);
      }
      if (body.quantity !== undefined) patch.quantity = Math.max(0, numeric(body.quantity));
      if (body.min_level !== undefined) patch.min_level = Math.max(0, numeric(body.min_level));
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      const updated = (await db.update(schema.consumables).set(patch).where(eq(schema.consumables.id, id)).returning())[0];
      return normalize(updated);
    }
    if (method === "DELETE") {
      await db.delete(schema.consumables).where(eq(schema.consumables.id, id));
      return { ok: true };
    }
    fail("Method not allowed", 405);
  }

  if (method === "GET") {
    const query = text(url.searchParams.get("search")).toLowerCase();
    const category = text(url.searchParams.get("category"));
    const status = text(url.searchParams.get("status"), "all");
    let rows = normalize(await db.select().from(schema.consumables).orderBy(asc(schema.consumables.name))) as Row[];
    if (category) rows = rows.filter((row) => row.category === category);
    if (query) rows = rows.filter((row) => [row.name, row.sku, row.asset_tag, row.bin_location].some((value) => String(value ?? "").toLowerCase().includes(query)));
    if (status === "low") rows = rows.filter((row) => row.quantity > 0 && row.quantity <= row.min_level);
    else if (status === "out") rows = rows.filter((row) => row.quantity <= 0);
    else if (status === "ok") rows = rows.filter((row) => row.quantity > row.min_level);
    else if (status === "active") rows = rows.filter((row) => row.is_active);
    return rows;
  }
  if (method === "POST") {
    const name = text(body.name);
    const sku = text(body.sku);
    if (!name) fail("Name is required");
    if (!sku) fail("SKU is required");
    const stamp = Date.now().toString(36).toUpperCase().slice(-5);
    const assetTag = text(body.asset_tag) || `AST-${sku.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8)}-${stamp}`;
    const created = (await db.insert(schema.consumables).values({
      name, sku, description: text(body.description), quantity: Math.max(0, numeric(body.quantity)),
      min_level: Math.max(0, numeric(body.min_level)), unit: text(body.unit, "ea") || "ea",
      category: text(body.category, "General") || "General", bin_location: text(body.bin_location),
      asset_tag: assetTag, notes: text(body.notes), is_active: body.is_active !== false, updated_at: now(),
    }).returning())[0];
    return normalize(created);
  }
  fail("Method not allowed", 405);
}

async function binsRoute(method: string, parts: string[], url: URL, body: Row) {
  const id = /^\d+$/.test(parts[1] ?? "") ? Number(parts[1]) : null;
  if (id) {
    if (method === "GET") { const item = await getBin(id); if (!item) fail("Bin not found", 404); return item; }
    if (method === "DELETE") { await db.delete(schema.bin_locations).where(eq(schema.bin_locations.id, id)); return { ok: true }; }
    if (method === "PATCH") {
      const patch: Row = { updated_at: now() };
      for (const key of ["code", "name", "zone", "aisle", "shelf", "description", "asset_tag"] as const) if (body[key] !== undefined) patch[key] = key === "code" ? text(body[key]).toUpperCase() : text(body[key]);
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      const updated = (await db.update(schema.bin_locations).set(patch).where(eq(schema.bin_locations.id, id)).returning())[0];
      if (!updated) fail("Bin not found", 404);
      return normalize(updated);
    }
    fail("Method not allowed", 405);
  }
  if (method === "GET") {
    const search = text(url.searchParams.get("search")).toLowerCase();
    let rows = normalize(await db.select().from(schema.bin_locations).orderBy(asc(schema.bin_locations.code))) as Row[];
    if (search) rows = rows.filter((row) => [row.code, row.name, row.zone, row.asset_tag].some((v) => String(v ?? "").toLowerCase().includes(search)));
    return rows;
  }
  if (method === "POST") {
    const code = text(body.code).toUpperCase(); const name = text(body.name);
    if (!code || !name) fail("Code and name are required");
    const tag = text(body.asset_tag) || `BIN-${code.replace(/[^a-z0-9]/gi, "").slice(0, 8)}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const created = (await db.insert(schema.bin_locations).values({ code, name, zone: text(body.zone), aisle: text(body.aisle), shelf: text(body.shelf), description: text(body.description), asset_tag: tag, is_active: body.is_active !== false, updated_at: now() }).returning())[0];
    return normalize(created);
  }
  fail("Method not allowed", 405);
}

async function printersRoute(method: string, parts: string[], body: Row) {
  const id = /^\d+$/.test(parts[1] ?? "") ? Number(parts[1]) : null;
  if (id) {
    if (method === "GET") { const row = await getPrinter(id); if (!row) fail("Printer not found", 404); return row; }
    if (method === "DELETE") { await db.delete(schema.printer_settings).where(eq(schema.printer_settings.id, id)); return { ok: true }; }
    if (method === "PATCH") {
      const patch: Row = {};
      for (const key of ["name", "host", "protocol", "notes"] as const) if (body[key] !== undefined) patch[key] = text(body[key]);
      for (const key of ["port", "dpi"] as const) if (body[key] !== undefined) patch[key] = Math.max(1, Math.trunc(numeric(body[key])));
      for (const key of ["label_width_mm", "label_height_mm"] as const) if (body[key] !== undefined) patch[key] = numeric(body[key]);
      if (body.is_default === true) {
        await db.update(schema.printer_settings).set({ is_default: false });
        patch.is_default = true;
      } else if (body.is_default === false) patch.is_default = false;
      const updated = (await db.update(schema.printer_settings).set(patch).where(eq(schema.printer_settings.id, id)).returning())[0];
      if (!updated) fail("Printer not found", 404);
      return normalize(updated);
    }
    fail("Method not allowed", 405);
  }
  if (method === "GET") return normalize(await db.select().from(schema.printer_settings).orderBy(desc(schema.printer_settings.is_default), asc(schema.printer_settings.name)));
  if (method === "POST") {
    const name = text(body.name); const host = text(body.host);
    if (!name || !host) fail("Name and host / IP are required");
    const isDefault = Boolean(body.is_default);
    if (isDefault) await db.update(schema.printer_settings).set({ is_default: false });
    const created = (await db.insert(schema.printer_settings).values({ name, host, port: Math.max(1, numeric(body.port, 9100)), protocol: text(body.protocol, "zpl") || "zpl", label_width_mm: numeric(body.label_width_mm, 101.6), label_height_mm: numeric(body.label_height_mm, 50.8), dpi: numeric(body.dpi, 203), is_default: isDefault, notes: text(body.notes) }).returning())[0];
    return normalize(created);
  }
  fail("Method not allowed", 405);
}

async function stockOrdersRoute(method: string, parts: string[], body: Row, url: URL) {
  const id = /^\d+$/.test(parts[1] ?? "") ? Number(parts[1]) : null;
  const action = parts[2] ?? "";
  if (id) {
    const rows = await db.select().from(schema.stock_orders).where(eq(schema.stock_orders.id, id)).limit(1);
    const order = rows[0];
    if (!order) fail("Order not found", 404);
    if (action === "cancel" && method === "POST") {
      if (order.status !== "ordered") fail(`Order is already ${order.status}`, 409, "ORDER_NOT_OPEN");
      const updated = (await db.update(schema.stock_orders).set({ status: "cancelled", note: [order.note, text(body.note)].filter(Boolean).join(" · ") }).where(eq(schema.stock_orders.id, id)).returning())[0];
      return normalize(updated);
    }
    if (action === "deliver" && method === "POST") {
      if (order.status !== "ordered") fail(`Order is already ${order.status}`, 409, "ORDER_NOT_OPEN");
      const received = Math.trunc(numeric(body.quantity_received ?? body.quantity, order.quantity_ordered));
      if (received <= 0) fail("quantity_received must be a positive whole number");
      const item = await getConsumable(order.consumable_id);
      if (!item) fail("Consumable not found for this order", 404);
      const previous = Number(item.quantity) || 0; const next = previous + received; const stamp = now();
      await db.update(schema.consumables).set({ quantity: next, updated_at: stamp }).where(eq(schema.consumables.id, item.id));
      const tx = (await db.insert(schema.stock_transactions).values({ consumable_id: item.id, change_amount: received, previous_quantity: previous, new_quantity: next, reason: "order_delivery", note: [order.note, text(body.note), `Order #${order.id}`].filter(Boolean).join(" · "), created_by: text(body.created_by, "operator") }).returning())[0];
      const updatedOrder = (await db.update(schema.stock_orders).set({ status: "delivered", quantity_received: received, received_by: text(body.created_by, "operator"), delivered_at: stamp }).where(eq(schema.stock_orders.id, id)).returning())[0];
      return normalize({ order: updatedOrder, consumable: { ...item, quantity: next, updated_at: stamp }, transaction: tx, previous_quantity: previous, new_quantity: next, quantity_received: received, variance: received - order.quantity_ordered });
    }
    if (method === "GET") return normalize(order);
    if (method === "PATCH") {
      if (order.status !== "ordered") fail("Only open (ordered) orders can be edited", 409, "ORDER_NOT_OPEN");
      const patch: Row = {};
      if (body.quantity_ordered !== undefined) { const quantity = Math.trunc(numeric(body.quantity_ordered)); if (quantity <= 0) fail("quantity_ordered must be positive"); patch.quantity_ordered = quantity; }
      if (body.note !== undefined) patch.note = text(body.note);
      const updated = (await db.update(schema.stock_orders).set(patch).where(eq(schema.stock_orders.id, id)).returning())[0];
      return normalize(updated);
    }
    if (method === "DELETE") {
      if (order.status === "delivered") fail("Delivered orders cannot be deleted", 409, "ORDER_DELIVERED");
      await db.delete(schema.stock_orders).where(eq(schema.stock_orders.id, id)); return { ok: true };
    }
  }
  if (method === "GET") {
    const status = text(url.searchParams.get("status"), "all"); const cid = Number(url.searchParams.get("consumable_id"));
    let rows = normalize(await db.select().from(schema.stock_orders).orderBy(desc(schema.stock_orders.ordered_at)).limit(200)) as Row[];
    if (status !== "all") rows = rows.filter((row) => row.status === status);
    if (Number.isFinite(cid) && cid > 0) rows = rows.filter((row) => row.consumable_id === cid);
    const items = normalize(await db.select().from(schema.consumables)) as Row[];
    const byId = new Map(items.map((item) => [item.id, item]));
    return rows.map((row) => ({ ...row, consumable_name: byId.get(row.consumable_id)?.name, consumable_sku: byId.get(row.consumable_id)?.sku, consumable_unit: byId.get(row.consumable_id)?.unit }));
  }
  if (method === "POST") {
    const consumableId = Math.trunc(numeric(body.consumable_id)); const item = await getConsumable(consumableId);
    if (!item) fail("Consumable not found", 404);
    const quantity = Math.trunc(numeric(body.quantity_ordered ?? body.quantity)); if (quantity <= 0) fail("quantity_ordered must be positive");
    const created = (await db.insert(schema.stock_orders).values({ consumable_id: consumableId, quantity_ordered: quantity, quantity_received: null, status: "ordered", note: text(body.note), ordered_by: text(body.created_by, "operator"), received_by: "", ordered_at: now(), delivered_at: null }).returning())[0];
    return normalize({ ...created, consumable_name: item.name, consumable_sku: item.sku, consumable_unit: item.unit });
  }
  fail("Method not allowed", 405);
}

async function transactionsRoute(url: URL) {
  const limit = Math.min(100, Math.max(1, Math.trunc(numeric(url.searchParams.get("limit"), 50))));
  const consumableId = Number(url.searchParams.get("consumable_id"));
  let rows = normalize(await db.select().from(schema.stock_transactions).orderBy(desc(schema.stock_transactions.created_at)).limit(limit)) as Row[];
  if (Number.isFinite(consumableId) && consumableId > 0) rows = rows.filter((row) => row.consumable_id === consumableId);
  const items = normalize(await db.select().from(schema.consumables)) as Row[];
  const byId = new Map(items.map((item) => [item.id, item]));
  return rows.map((row) => ({ ...row, consumable_name: byId.get(row.consumable_id)?.name, consumable_sku: byId.get(row.consumable_id)?.sku }));
}

async function dashboardRoute() {
  const items = (normalize(await db.select().from(schema.consumables)) as Row[]).filter((row) => row.is_active !== false);
  const bins = (normalize(await db.select().from(schema.bin_locations)) as Row[]).filter((row) => row.is_active !== false);
  const txs = normalize(await db.select().from(schema.stock_transactions).orderBy(desc(schema.stock_transactions.created_at)).limit(12)) as Row[];
  const orders = normalize(await db.select().from(schema.stock_orders).where(eq(schema.stock_orders.status, "ordered")).orderBy(desc(schema.stock_orders.ordered_at)).limit(20)) as Row[];
  const byId = new Map(items.map((item) => [item.id, item]));
  const low = items.filter((item) => item.quantity > 0 && item.quantity <= item.min_level);
  const out = items.filter((item) => item.quantity <= 0);
  return {
    total_items: items.length, low_stock_count: low.length, out_of_stock_count: out.length, total_bins: bins.length,
    pending_orders_count: orders.length,
    pending_orders: orders.map((order) => ({ ...order, consumable_name: byId.get(order.consumable_id)?.name, consumable_sku: byId.get(order.consumable_id)?.sku, consumable_unit: byId.get(order.consumable_id)?.unit })),
    recent_transactions: txs.map((tx) => ({ ...tx, consumable_name: byId.get(tx.consumable_id)?.name, consumable_sku: byId.get(tx.consumable_id)?.sku })),
    low_stock_items: low.slice(0, 8), needs_attention: [...out, ...low].slice(0, 12),
  };
}

async function procurementRoute(method: string, parts: string[], body: Row) {
  const action = parts[1] ?? ""; const id = /^\d+$/.test(parts[1] ?? "") ? Number(parts[1]) : null;
  if (action === "status" && method === "GET") {
    const dayKey = dateKeyInDenver(); const closePassed = localClosePassed(); const queueDay = closePassed ? nextDateKey(dayKey) : dayKey;
    const allLines = normalize(await db.select().from(schema.procurement_order_lines)) as Row[];
    const todayLines = allLines.filter((line) => line.day_key === dayKey);
    const queueLines = allLines.filter((line) => line.day_key === queueDay);
    const batches = normalize(await db.select().from(schema.procurement_batches).orderBy(desc(schema.procurement_batches.created_at)).limit(20)) as Row[];
    const batch = batches.find((row) => row.day_key === dayKey) ?? null;
    const history = batches;
    const locked = Boolean(batch) || closePassed;
    const lines = queueDay === dayKey ? todayLines : queueLines;
    return { day_key: dayKey, queue_day_key: queueDay, past_close: closePassed, close_schedule: "2:30pm America/Denver", locked, batch, history, open_count: lines.filter((line) => line.status === "open").length, submitted_count: lines.filter((line) => line.status === "submitted").length, integrations: { jira: { configured: false, missing: ["server integration unavailable in local storage"], dryRun: true }, slack: { configured: false, missing: ["server integration unavailable in local storage"], dryRun: true }, dry_run: true, dry_run_reason: "PGlite local mode stores records in this browser and does not submit to Jira or Slack.", mode: "dry-run" } };
  }
  if (action === "settings") {
    const current = (await db.select().from(schema.procurement_settings).limit(1))[0];
    if (method === "GET") return normalize(current ?? null);
    if (method === "PATCH") {
      const patch: Row = { updated_by: text(body.updated_by, "local operator"), updated_at: now() };
      for (const key of ["jira_summary_template", "jira_description_template", "slack_channel_id", "slack_ping_user_id", "jira_project_key", "jira_issue_type"] as const) if (body[key] !== undefined) patch[key] = text(body[key]);
      const row = current ? (await db.update(schema.procurement_settings).set(patch).where(eq(schema.procurement_settings.id, current.id)).returning())[0] : (await db.insert(schema.procurement_settings).values({ jira_summary_template: text(body.jira_summary_template), jira_description_template: text(body.jira_description_template), slack_channel_id: text(body.slack_channel_id), slack_ping_user_id: text(body.slack_ping_user_id), jira_project_key: text(body.jira_project_key), jira_issue_type: text(body.jira_issue_type), updated_by: text(body.updated_by, "local operator"), updated_at: now() }).returning())[0];
      return normalize(row);
    }
  }
  if (action === "close" && method === "POST") {
    const dayKey = text(body.day_key, dateKeyInDenver());
    const openLines = normalize(await db.select().from(schema.procurement_order_lines)) as Row[];
    const selected = openLines.filter((line) => line.day_key === dayKey && line.status === "open");
    const batch = (await db.insert(schema.procurement_batches).values({ day_key: dayKey, status: selected.length ? "submitted" : "empty_skipped", line_count: selected.length, jira_issue_key: "", jira_issue_url: "", slack_channel_id: "", slack_message_ts: "", dry_run: true, error_message: "Local PGlite mode: no Jira or Slack submission was made.", submitted_at: now() }).returning())[0];
    for (const line of selected) await db.update(schema.procurement_order_lines).set({ status: "submitted", batch_id: batch.id, submitted_at: now(), updated_at: now() }).where(eq(schema.procurement_order_lines.id, line.id));
    return normalize({ ok: true, skipped: !selected.length, reason: selected.length ? "Local-only close; external submission disabled" : "No open lines", dayKey, batch, lineCount: selected.length, dryRun: true, dryRunReason: "PGlite local mode does not submit to Jira or Slack.", mode: "dry-run" });
  }
  if (id) {
    const current = (await db.select().from(schema.procurement_order_lines).where(eq(schema.procurement_order_lines.id, id)).limit(1))[0];
    if (!current) fail("Procurement line not found", 404);
    if (method === "DELETE") { await db.delete(schema.procurement_order_lines).where(eq(schema.procurement_order_lines.id, id)); return { ok: true }; }
    if (method === "PATCH") {
      if (current.status !== "open") fail("Only open lines can be edited", 409);
      const patch: Row = { updated_at: now() };
      if (body.link !== undefined) patch.link = text(body.link);
      if (body.quantity !== undefined) patch.quantity = Math.max(1, Math.trunc(numeric(body.quantity, 1)));
      if (body.notes !== undefined) patch.notes = text(body.notes);
      return normalize((await db.update(schema.procurement_order_lines).set(patch).where(eq(schema.procurement_order_lines.id, id)).returning())[0]);
    }
  }
  if (method === "GET") {
    const dayKey = dateKeyInDenver();
    return normalize(await db.select().from(schema.procurement_order_lines).where(eq(schema.procurement_order_lines.day_key, dayKey)).orderBy(desc(schema.procurement_order_lines.created_at)));
  }
  if (method === "POST") {
    const link = text(body.link); if (!link) fail("A product link is required");
    const userEmail = text(body.created_by_email, "local@browser").toLowerCase();
    const row = (await db.insert(schema.procurement_order_lines).values({ day_key: text(body.day_key, dateKeyInDenver()), link, quantity: Math.max(1, Math.trunc(numeric(body.quantity, 1))), notes: text(body.notes), created_by_email: userEmail, created_by_name: text(body.created_by_name, "Local user"), status: "open", batch_id: null, submitted_at: null, updated_at: now() }).returning())[0];
    return normalize(row);
  }
  fail("Method not allowed", 405);
}

async function alertSettingsRoute(method: string, parts: string[], body: Row) {
  const settingsRows = await db.select().from(schema.consumables_alert_settings).limit(1);
  const current = settingsRows[0];
  if (parts[1] === "settings" || !parts[1]) {
    if (method === "GET") return normalize(current ?? null);
    if (method === "PATCH") {
      const patch: Row = { updated_by: text(body.updated_by, "local operator"), updated_at: now() };
      for (const key of ["approaching_ratio", "schedule_weekday", "schedule_hour_mst"] as const) if (body[key] !== undefined) patch[key] = numeric(body[key]);
      for (const key of ["weekly_enabled", "include_out_of_stock", "include_below_minimum", "include_approaching", "include_good"] as const) if (body[key] !== undefined) patch[key] = Boolean(body[key]);
      for (const key of ["slack_channel_id", "slack_ping_user_id", "jira_project_key", "jira_issue_type", "jira_summary_template", "jira_intro_template", "jira_section_heading_template", "jira_item_line_template", "jira_empty_section_template", "jira_footer_template", "jira_description_template"] as const) if (body[key] !== undefined) patch[key] = text(body[key]);
      const values = { approaching_ratio: numeric(body.approaching_ratio, 1.25), weekly_enabled: body.weekly_enabled !== false, include_out_of_stock: body.include_out_of_stock !== false, include_below_minimum: body.include_below_minimum !== false, include_approaching: body.include_approaching !== false, include_good: body.include_good !== false, schedule_weekday: Math.max(1, numeric(body.schedule_weekday, 1)), schedule_hour_mst: numeric(body.schedule_hour_mst, 8), slack_channel_id: text(body.slack_channel_id), slack_ping_user_id: text(body.slack_ping_user_id), jira_project_key: text(body.jira_project_key), jira_issue_type: text(body.jira_issue_type), jira_summary_template: text(body.jira_summary_template, "Consumables weekly inventory {{week}}"), jira_intro_template: text(body.jira_intro_template, "Summary: {{out_count}} out · {{below_count}} below · {{approaching_count}} approaching"), jira_section_heading_template: text(body.jira_section_heading_template, "## {{title}} ({{count}})"), jira_item_line_template: text(body.jira_item_line_template, "- {{name}}: {{qty}} {{unit}} on hand"), jira_empty_section_template: text(body.jira_empty_section_template, "(none)"), jira_footer_template: text(body.jira_footer_template, "Order total: {{order_total}} units"), jira_description_template: text(body.jira_description_template, "{{intro}}\n\n{{sections}}\n\n{{footer}}"), updated_by: text(body.updated_by, "local operator"), updated_at: now() };
      const row = current ? (await db.update(schema.consumables_alert_settings).set(patch).where(eq(schema.consumables_alert_settings.id, current.id)).returning())[0] : (await db.insert(schema.consumables_alert_settings).values(values).returning())[0];
      return normalize(row);
    }
  }
  if (parts[1] === "status" && method === "GET") {
    const items = (normalize(await db.select().from(schema.consumables)) as Row[]).filter((item) => item.is_active !== false);
    const config = normalize(current ?? null) as Row | null;
    const ratio = numeric(config?.approaching_ratio, 1.25);
    const categorized = items.map((item) => {
      const status = item.quantity <= 0 ? "out_of_stock" : item.quantity <= item.min_level ? "below_minimum" : item.quantity <= item.min_level * ratio ? "approaching" : "good";
      return { ...item, status, approaching_ceiling: Math.ceil(item.min_level * ratio), approaching_ratio: ratio, restock_target: item.min_level * 2, qty_to_order: Math.max(0, item.min_level * 2 - item.quantity) };
    });
    const counts = { out_of_stock: categorized.filter((r) => r.status === "out_of_stock").length, below_minimum: categorized.filter((r) => r.status === "below_minimum").length, approaching: categorized.filter((r) => r.status === "approaching").length, good: categorized.filter((r) => r.status === "good").length, total: categorized.length };
    const batches = normalize(await db.select().from(schema.consumables_alert_batches).orderBy(desc(schema.consumables_alert_batches.created_at)).limit(20));
    return { week_key: currentDenverWeekKey(), day_key: dateKeyInDenver(), schedule: "Monday 8:00 AM America/Denver", locked: false, batch: batches.find((row: Row) => row.week_key === currentDenverWeekKey()) ?? null, history: batches, counts: { ...counts, units_to_order: categorized.reduce((sum, item) => sum + item.qty_to_order, 0), skus_to_order: categorized.filter((item) => item.qty_to_order > 0).length }, items: categorized, settings: config, integrations: { jira: { configured: false, missing: ["local PGlite mode"], dryRun: true }, slack: { configured: false, missing: ["local PGlite mode"], dryRun: true }, dry_run: true, dry_run_reason: "Local storage cannot submit external Jira or Slack actions.", mode: "dry-run" } };
  }
  if (parts[1] === "run" && method === "POST") return runAlertsLocally();
  fail("Method not allowed", 405);
}

async function runAlertsLocally() {
  const items = (normalize(await db.select().from(schema.consumables)) as Row[]).filter((item) => item.is_active !== false);
  const weekKey = currentDenverWeekKey();
  const existing = (await db.select().from(schema.consumables_alert_batches).where(eq(schema.consumables_alert_batches.week_key, weekKey)).limit(1))[0];
  if (existing) return normalize({ ok: true, skipped: true, reason: "A local report already exists for this week", weekKey, batch: existing, dryRun: true, message: "No Jira or Slack message was sent." });
  const settings = (await db.select().from(schema.consumables_alert_settings).limit(1))[0];
  const ratio = numeric(settings?.approaching_ratio, 1.25);
  const counts = { out: 0, below: 0, approaching: 0, good: 0 };
  for (const item of items) {
    if (item.quantity <= 0) counts.out++;
    else if (item.quantity <= item.min_level) counts.below++;
    else if (item.quantity <= item.min_level * ratio) counts.approaching++;
    else counts.good++;
  }
  const batch = (await db.insert(schema.consumables_alert_batches).values({ week_key: weekKey, status: "empty_skipped", item_count: items.length, out_of_stock_count: counts.out, below_minimum_count: counts.below, approaching_count: counts.approaching, good_count: counts.good, jira_issue_key: "", jira_issue_url: "", slack_channel_id: "", slack_message_ts: "", dry_run: true, error_message: "Local PGlite mode: no Jira or Slack submission was made.", submitted_at: now() }).returning())[0];
  return normalize({ ok: true, skipped: false, reason: "Local-only alert preview saved", weekKey, batch, counts, dryRun: true, message: "No Jira issue or Slack message was sent." });
}

async function printRoute(body: Row) {
  const type = text(body.type);
  const id = Math.trunc(numeric(body.id));
  if (!id || !["consumable", "bin"].includes(type)) fail("Valid label type and id are required");
  const printerRows = normalize(await db.select().from(schema.printer_settings)) as Row[];
  const printer = printerRows.find((row) => row.id === Number(body.printer_id)) ?? printerRows.find((row) => row.is_default) ?? printerRows[0] ?? null;
  const size = printer ? { widthMm: printer.label_width_mm, heightMm: printer.label_height_mm, dpi: printer.dpi } : DEFAULT_LABEL_SIZE;
  let label: Row; let zpl: string;
  if (type === "consumable") {
    const item = await getConsumable(id); if (!item) fail("Consumable not found", 404);
    label = { kind: "consumable", name: item.name, sku: item.sku, asset_tag: item.asset_tag, bin_location: item.bin_location };
    zpl = buildConsumableLabelZpl(item as any, size);
  } else {
    const bin = await getBin(id); if (!bin) fail("Bin not found", 404);
    label = { kind: "bin", code: bin.code, name: bin.name, asset_tag: bin.asset_tag, zone: bin.zone, aisle: bin.aisle, shelf: bin.shelf };
    zpl = buildBinLocationLabelZpl(bin as any, size);
  }
  const copies = Math.min(20, Math.max(1, Math.trunc(numeric(body.copies, 1))));
  return { ok: true, dry_run: true, zpl: Array.from({ length: copies }, () => zpl).join("\r\n"), copies, printer: printer ? { id: printer.id, name: printer.name, host: printer.host, port: printer.port } : null, label, hint: "PGlite browser mode can generate ZPL but cannot send directly to a LAN printer. Download the ZPL and print from a device on the printer network." };
}

async function scanRoute(body: Row) {
  const code = text(body.code ?? body.asset_tag ?? body.sku);
  if (!code) fail("Scan code is required", 400, "MISSING_CODE");
  const items = normalize(await db.select().from(schema.consumables)) as Row[];
  const lower = code.toLowerCase();
  const item = items.find((row) => String(row.asset_tag ?? "").toLowerCase() === lower) ?? items.find((row) => String(row.sku ?? "").toLowerCase() === lower);
  if (!item) fail(`No consumable found for “${code}”`, 404, "NOT_FOUND");
  const requested = Math.max(1, Math.trunc(Math.abs(numeric(body.amount ?? body.qty ?? body.quantity, 1))));
  const preview = Boolean(body.dry_run || body.lookup_only);
  const previous = numeric(item.quantity);
  if (preview) return { ok: true, dry_run: true, consumable: item, amount: requested, low_stock: previous > 0 && previous <= item.min_level, out_of_stock: previous <= 0, scanned: code };
  if (previous <= 0) fail(`${item.name} is already out of stock`, 409, "OUT_OF_STOCK");
  const used = Math.min(requested, previous); const next = previous - used; const stamp = now();
  const updated = (await db.update(schema.consumables).set({ quantity: next, updated_at: stamp }).where(eq(schema.consumables.id, item.id)).returning())[0];
  const transaction = (await db.insert(schema.stock_transactions).values({ consumable_id: item.id, change_amount: -used, previous_quantity: previous, new_quantity: next, reason: "scan", note: text(body.note, "scanned"), created_by: text(body.created_by, "scanner") }).returning())[0];
  return normalize({ ok: true, consumable: updated, transaction, amount: used, requested_amount: requested, capped: used !== requested, low_stock: next > 0 && next <= updated.min_level, out_of_stock: next <= 0, scanned: code, previous_quantity: previous, new_quantity: next });
}

export async function seedPgliteDemo(force = false) {
  await dbReady;
  const current = await db.select({ id: schema.consumables.id }).from(schema.consumables).limit(1);
  if (current.length && !force) return { ok: true, skipped: true, message: "Local PGlite already contains inventory." };
  if (force) {
    await db.delete(schema.stock_orders);
    await db.delete(schema.stock_transactions);
    await db.delete(schema.consumables);
    await db.delete(schema.bin_locations);
    await db.delete(schema.printer_settings);
    await db.delete(schema.procurement_order_lines);
    await db.delete(schema.procurement_batches);
    await db.delete(schema.procurement_settings);
    await db.delete(schema.consumables_alert_batches);
    await db.delete(schema.consumables_alert_settings);
  }
  const bins = await db.insert(schema.bin_locations).values([
    { code: "A-01-01", name: "Fasteners — Upper", zone: "A", aisle: "01", shelf: "01", description: "Bolts, nuts, washers", asset_tag: "BIN-A0101-DEMO1", is_active: true, updated_at: now() },
    { code: "B-02-01", name: "PPE Rack", zone: "B", aisle: "02", shelf: "01", description: "Gloves and eye protection", asset_tag: "BIN-B0201-DEMO2", is_active: true, updated_at: now() },
  ]).returning();
  const items = await db.insert(schema.consumables).values([
    { name: "M8 Hex Bolts", sku: "BOLT-M8-25", description: "M8 x 25mm zinc hex bolts", quantity: 120, min_level: 40, unit: "ea", category: "Fasteners", bin_location: "A-01-01", asset_tag: "AST-BOLTM8-DEMO1", notes: "Supplier pack of 100", is_active: true, updated_at: now() },
    { name: "Nitrile Gloves (L)", sku: "PPE-GLV-L", description: "Powder-free nitrile, large", quantity: 6, min_level: 12, unit: "box", category: "PPE", bin_location: "B-02-01", asset_tag: "AST-GLVL-DEMO2", notes: "", is_active: true, updated_at: now() },
    { name: "Safety Glasses", sku: "PPE-GLS-CLR", description: "Clear polycarbonate safety glasses", quantity: 0, min_level: 10, unit: "ea", category: "PPE", bin_location: "B-02-01", asset_tag: "AST-GLSCLR-DEMO3", notes: "Out of stock", is_active: true, updated_at: now() },
  ]).returning();
  await db.insert(schema.printer_settings).values({ name: "Retrievals Printer", host: "192.168.96.21", port: 9100, protocol: "zpl", label_width_mm: 101.6, label_height_mm: 50.8, dpi: 203, is_default: true, notes: "Local demo printer profile; use Download ZPL in browser storage mode." });
  if (items[0]) await db.insert(schema.stock_transactions).values({ consumable_id: items[0].id, change_amount: -5, previous_quantity: 125, new_quantity: 120, reason: "use", note: "Production line A", created_by: "demo" });
  if (items[1]) await db.insert(schema.stock_orders).values({ consumable_id: items[1].id, quantity_ordered: 24, quantity_received: null, status: "ordered", note: "Demo restock order", ordered_by: "demo", received_by: "", ordered_at: now(), delivered_at: null });
  return { ok: true, skipped: false, bins: bins.length, consumables: items.length, printers: 1, stock_orders: items[1] ? 1 : 0 };
}

export async function requestPglite<T>(path: string, init?: RequestInit): Promise<T> {
  await dbReady;
  const url = new URL(path, window.location.origin);
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const resource = parts[0] ?? "";
  const method = (init?.method ?? "GET").toUpperCase();
  const body = rowFromBody(init);
  let data: unknown;
  if (resource === "consumables") data = await consumablesRoute(method, parts, url, body);
  else if (resource === "bin-locations") data = await binsRoute(method, parts, url, body);
  else if (resource === "printers") data = await printersRoute(method, parts, body);
  else if (resource === "stock-orders") data = await stockOrdersRoute(method, parts, body, url);
  else if (resource === "transactions" && method === "GET") data = await transactionsRoute(url);
  else if (resource === "dashboard" && method === "GET") data = await dashboardRoute();
  else if (resource === "scan" && method === "POST") data = await scanRoute(body);
  else if (resource === "procurement") data = await procurementRoute(method, parts, body);
  else if (resource === "consumables-alerts") data = await alertSettingsRoute(method, parts, body);
  else if (resource === "print" && method === "POST") data = await printRoute(body);
  else if (resource === "seed" && method === "POST") data = await seedPgliteDemo();
  else if (resource === "integrations" && parts[1] === "test" && method === "POST") data = {
    ok: true,
    mode: text(body.mode, "auth"),
    dry_run: true,
    message: "PGlite local mode: no Jira or Slack requests were sent.",
    integrations: {
      jira: { configured: false, missing: ["Unavailable in browser-local mode"], dryRun: true },
      slack: { configured: false, missing: ["Unavailable in browser-local mode"], dryRun: true },
      dry_run: true,
      dry_run_reason: "PGlite stores data in this browser and does not call external integrations.",
      mode: "dry-run",
    },
  };
  else fail(`Unsupported local endpoint: ${url.pathname}`, 501);
  return normalize(data) as T;
}
