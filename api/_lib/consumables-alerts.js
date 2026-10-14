/**
 * Weekly consumables inventory alerts.
 *
 * Trigger: Vercel Cron (Monday 8:00am MST by default) or admin "Run weekly report now".
 * Creates one summary Jira ticket + Slack message with the ticket link.
 *
 * Stock status buckets (active items only), report order:
 *   1. out_of_stock  — quantity <= 0
 *   2. below_minimum — quantity > 0 && quantity <= min_level
 *   3. approaching   — quantity > min_level && quantity <= min_level * approaching_ratio
 *   4. good          — quantity > min_level * approaching_ratio
 *
 * Approaching ratio and included sections are admin-configurable (DB settings).
 *
 * Env (reuses Warehouse Procurement bots by default):
 *   SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SLACK_PING_USER_ID
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE
 *   PROCUREMENT_DRY_RUN / CONSUMABLES_ALERTS_DRY_RUN
 * Optional overrides (also overridable from admin settings):
 *   CONSUMABLES_SLACK_CHANNEL_ID, CONSUMABLES_SLACK_PING_USER_ID
 *   CONSUMABLES_JIRA_PROJECT_KEY, CONSUMABLES_JIRA_ISSUE_TYPE
 */

import { supabaseAdmin } from "./supabase-admin.js";
import { isDevAuthEnabled } from "./dev-auth.js";
import { denverDayKey } from "./denver-day.js";
import { createJiraIssue, jiraConfigStatus } from "./jira-client.js";
import { postSlackMessage, slackConfigStatus } from "./slack-client.js";
import {
  DEFAULT_APPROACHING_RATIO,
  DEFAULT_JIRA_DESCRIPTION,
  DEFAULT_JIRA_EMPTY_SECTION,
  DEFAULT_JIRA_FOOTER,
  DEFAULT_JIRA_INTRO,
  DEFAULT_JIRA_ITEM_LINE,
  DEFAULT_JIRA_SECTION_HEADING,
  DEFAULT_JIRA_SUMMARY,
  consumablesAlertsScheduleLabelFromSettings,
  ensureConsumablesAlertSettings,
  normalizeApproachingRatio,
  resolveConsumablesAlertsRoutingFromSettings,
  serializeAlertSettings,
} from "./consumables-alert-settings.js";
import { applyTemplate } from "./procurement-template.js";

/** @deprecated Prefer settings.approaching_ratio; kept for tests / defaults. */
export const APPROACHING_RATIO = DEFAULT_APPROACHING_RATIO;

/** Restock target = min × 2 (matches client restock report). */
export function restockTargetQty(minLevel) {
  return Math.max(0, Math.trunc(Number(minLevel) || 0)) * 2;
}

/** Units to order to reach restock target. */
export function qtyToOrder(quantity, minLevel) {
  const qty = Math.max(0, Math.trunc(Number(quantity) || 0));
  return Math.max(0, restockTargetQty(minLevel) - qty);
}

export const STATUS_ORDER = [
  "out_of_stock",
  "below_minimum",
  "approaching",
  "good",
];

/**
 * @param {{ quantity?: unknown, min_level?: unknown }} item
 * @param {number} [approachingRatio]
 * @returns {"out_of_stock"|"below_minimum"|"approaching"|"good"}
 */
export function classifyConsumableStock(
  item,
  approachingRatio = APPROACHING_RATIO,
) {
  const qty = Math.max(0, Number(item?.quantity) || 0);
  const min = Math.max(0, Number(item?.min_level) || 0);
  const ratio = normalizeApproachingRatio(approachingRatio);
  if (qty <= 0) return "out_of_stock";
  if (qty <= min) return "below_minimum";
  const approachCeiling = min * ratio;
  if (qty <= approachCeiling) return "approaching";
  return "good";
}

/**
 * ISO week key in America/Denver, e.g. "2026-W41".
 * @param {Date} [date]
 */
export function denverWeekKey(date = new Date()) {
  const dayKey = denverDayKey(date);
  const [y, m, d] = dayKey.split("-").map(Number);
  // Noon UTC on the Denver calendar date avoids DST edge flips.
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // ISO week: Thursday-based year; week starts Monday.
  const day = utcNoon.getUTCDay() || 7; // 1=Mon … 7=Sun
  utcNoon.setUTCDate(utcNoon.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcNoon.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcNoon - yearStart) / 86400000 + 1) / 7);
  const isoYear = utcNoon.getUTCFullYear();
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function consumablesAlertsScheduleLabel() {
  return "Monday 8:00am MST (America/Denver)";
}

/**
 * Env-only routing (no DB). Prefer resolveConsumablesAlertsRoutingAsync.
 */
export function resolveConsumablesAlertsRouting() {
  return resolveConsumablesAlertsRoutingFromSettings({});
}

/**
 * @param {Array<Record<string, unknown>>} items
 * @param {{ approachingRatio?: number }} [opts]
 */
export function buildConsumablesReport(items, opts = {}) {
  const approachingRatio = normalizeApproachingRatio(
    opts.approachingRatio ?? APPROACHING_RATIO,
  );

  /** @type {Record<string, Array<Record<string, unknown>>>} */
  const buckets = {
    out_of_stock: [],
    below_minimum: [],
    approaching: [],
    good: [],
  };

  /** @type {Array<Record<string, unknown>>} */
  const skuRows = [];

  for (const item of items) {
    const status = classifyConsumableStock(item, approachingRatio);
    const qty = Math.max(0, Number(item?.quantity) || 0);
    const min = Math.max(0, Number(item?.min_level) || 0);
    const target = restockTargetQty(min);
    const orderQty = qtyToOrder(qty, min);
    const row = {
      id: Number(item?.id) || 0,
      name: String(item?.name ?? "Item"),
      sku: String(item?.sku ?? ""),
      quantity: qty,
      min_level: min,
      unit: String(item?.unit ?? "ea").trim() || "ea",
      bin_location: String(item?.bin_location ?? ""),
      category: String(item?.category ?? ""),
      status,
      approaching_ceiling: Math.round(min * approachingRatio * 100) / 100,
      approaching_ratio: approachingRatio,
      restock_target: target,
      qty_to_order: orderQty,
    };
    buckets[status].push(row);
    skuRows.push(row);
  }

  for (const key of STATUS_ORDER) {
    buckets[key].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
    );
  }

  skuRows.sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(String(a.status));
    const bi = STATUS_ORDER.indexOf(String(b.status));
    if (ai !== bi) return ai - bi;
    return String(a.name).localeCompare(String(b.name));
  });

  const unitsToOrder = skuRows.reduce(
    (sum, row) => sum + (Number(row.qty_to_order) || 0),
    0,
  );
  const skusNeedingOrder = skuRows.filter(
    (row) => (Number(row.qty_to_order) || 0) > 0,
  ).length;

  const counts = {
    out_of_stock: buckets.out_of_stock.length,
    below_minimum: buckets.below_minimum.length,
    approaching: buckets.approaching.length,
    good: buckets.good.length,
    total: items.length,
    units_to_order: unitsToOrder,
    skus_to_order: skusNeedingOrder,
  };

  return { buckets, counts, items: skuRows, approachingRatio };
}

/**
 * @param {Record<string, unknown>} settings
 */
function includedSectionKeys(settings) {
  /** @type {Array<{ title: string, key: string }>} */
  const sections = [];
  if (settings?.include_out_of_stock !== false) {
    sections.push({ title: "Out of Stock", key: "out_of_stock" });
  }
  if (settings?.include_below_minimum !== false) {
    sections.push({ title: "Below minimum", key: "below_minimum" });
  }
  if (settings?.include_approaching !== false) {
    sections.push({
      title: "Approaching minimum",
      key: "approaching",
    });
  }
  if (settings?.include_good !== false) {
    sections.push({ title: "Good", key: "good" });
  }
  return sections;
}

/**
 * @param {Record<string, unknown>} item
 * @param {string} itemLineTpl
 */
function formatItemLine(item, itemLineTpl) {
  const name = String(item.name ?? "Item");
  const sku = String(item.sku ?? "").trim();
  const qty = Number(item.quantity) || 0;
  const min = Number(item.min_level) || 0;
  const unit = String(item.unit ?? "ea").trim() || "ea";
  const bin = String(item.bin_location ?? "").trim();
  const order =
    item.qty_to_order != null
      ? Number(item.qty_to_order) || 0
      : qtyToOrder(qty, min);
  const target =
    item.restock_target != null
      ? Number(item.restock_target) || 0
      : restockTargetQty(min);
  return applyTemplate(itemLineTpl, {
    name,
    sku,
    qty,
    min,
    unit,
    bin,
    order,
    restock_target: target,
    sku_part: sku ? ` [${sku}]` : "",
    order_part: order > 0 ? ` · order ${order} ${unit}` : "",
    bin_part: bin ? ` · bin ${bin}` : "",
  }).trimEnd();
}

/**
 * @param {{
 *   weekKey: string,
 *   report: ReturnType<typeof buildConsumablesReport>,
 *   settings?: Record<string, unknown>,
 * }} opts
 */
export function renderConsumablesAlertTicket(opts) {
  const { weekKey, report } = opts;
  const settings = opts.settings ?? {
    approaching_ratio: report.approachingRatio ?? APPROACHING_RATIO,
    include_out_of_stock: true,
    include_below_minimum: true,
    include_approaching: true,
    include_good: true,
    jira_summary_template: DEFAULT_JIRA_SUMMARY,
    jira_intro_template: DEFAULT_JIRA_INTRO,
    jira_section_heading_template: DEFAULT_JIRA_SECTION_HEADING,
    jira_item_line_template: DEFAULT_JIRA_ITEM_LINE,
    jira_empty_section_template: DEFAULT_JIRA_EMPTY_SECTION,
    jira_footer_template: DEFAULT_JIRA_FOOTER,
    jira_description_template: DEFAULT_JIRA_DESCRIPTION,
  };
  const c = report.counts;
  const orderTotal = Number(c.units_to_order) || 0;

  const sectionHeadingTpl =
    String(settings.jira_section_heading_template ?? "").trim() ||
    DEFAULT_JIRA_SECTION_HEADING;
  const itemLineTpl =
    String(settings.jira_item_line_template ?? "").trim() ||
    DEFAULT_JIRA_ITEM_LINE;
  const emptySectionTpl =
    String(settings.jira_empty_section_template ?? "").trim() ||
    DEFAULT_JIRA_EMPTY_SECTION;

  const sectionDefs = includedSectionKeys(settings);
  const sectionLines = [];
  for (const section of sectionDefs) {
    const rows = report.buckets[section.key] ?? [];
    sectionLines.push(
      applyTemplate(sectionHeadingTpl, {
        title: section.title,
        count: rows.length,
        key: section.key,
      }).trimEnd(),
    );
    if (rows.length === 0) {
      sectionLines.push(emptySectionTpl);
    } else {
      for (const item of rows) {
        sectionLines.push(formatItemLine(item, itemLineTpl));
      }
    }
    sectionLines.push("");
  }
  if (sectionDefs.length === 0) {
    sectionLines.push(
      applyTemplate(sectionHeadingTpl, {
        title: "(no sections enabled in alert settings)",
        count: 0,
        key: "none",
      }).trimEnd(),
    );
    sectionLines.push(emptySectionTpl);
  }

  const countVars = {
    week: weekKey,
    out_count: c.out_of_stock,
    below_count: c.below_minimum,
    approaching_count: c.approaching,
    good_count: c.good,
    total: c.total,
    order_total: orderTotal,
    skus_to_order: Number(c.skus_to_order) || 0,
    order_summary_clause:
      orderTotal > 0 ? ` · order ${orderTotal} units` : "",
  };

  const introTpl =
    String(settings.jira_intro_template ?? "").trim() || DEFAULT_JIRA_INTRO;
  const footerTpl =
    String(settings.jira_footer_template ?? "").trim() || DEFAULT_JIRA_FOOTER;
  const intro = applyTemplate(introTpl, countVars).trim();
  const footer = applyTemplate(footerTpl, countVars).trim();
  const sections = sectionLines.join("\n").trim();

  const layoutVars = {
    ...countVars,
    intro,
    sections,
    footer,
    // Back-compat for older layout templates
    summary_line: intro,
  };

  const summaryTpl =
    String(settings.jira_summary_template ?? "").trim() || DEFAULT_JIRA_SUMMARY;
  let descTpl =
    String(settings.jira_description_template ?? "").trim() ||
    DEFAULT_JIRA_DESCRIPTION;
  // Migrate legacy default that inlined the footer instead of {{footer}}
  if (descTpl.includes("{{summary_line}}") && !descTpl.includes("{{intro}}")) {
    descTpl = descTpl.replace(/\{\{\s*summary_line\s*\}\}/g, "{{intro}}");
  }

  return {
    summary: applyTemplate(summaryTpl, countVars).trim().slice(0, 255) ||
      applyTemplate(DEFAULT_JIRA_SUMMARY, countVars).trim().slice(0, 255),
    description: applyTemplate(descTpl, layoutVars).trim(),
  };
}

/**
 * @param {{
 *   weekKey: string,
 *   issueKey: string,
 *   issueUrl: string,
 *   counts: { out_of_stock: number, below_minimum: number, approaching: number, good: number, total: number },
 * }} opts
 */
export function buildConsumablesAlertsSlackText(opts) {
  const key = opts.issueKey || "ticket";
  const url = opts.issueUrl || "";
  const linkPart = url ? `<${url}|${key}>` : key;
  const c = opts.counts;
  return (
    `Weekly consumables inventory report for ${opts.weekKey} ` +
    `(${c.out_of_stock} out of stock, ${c.below_minimum} below min, ` +
    `${c.approaching} approaching, ${c.good} good / ${c.total} items). ` +
    `Jira: ${linkPart}`
  );
}

/**
 * @param {{ weekKey?: string, dryRun?: boolean, triggeredBy?: string, force?: boolean }} [opts]
 */
export async function runConsumablesWeeklyAlerts(opts = {}) {
  const weekKey = String(opts.weekKey || denverWeekKey()).trim();
  const dayKey = denverDayKey();
  const settingsRow = await ensureConsumablesAlertSettings();
  const settings = serializeAlertSettings(settingsRow);
  const routing = resolveConsumablesAlertsRoutingFromSettings(settingsRow);
  let dryRun =
    opts.dryRun != null ? Boolean(opts.dryRun) : routing.dryRunEnv;
  const triggeredBy = String(opts.triggeredBy ?? "cron").trim() || "cron";
  const force = Boolean(opts.force);
  const isCron = triggeredBy === "cron" || triggeredBy.startsWith("cron");

  if (isCron && !settings.weekly_enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "weekly_disabled",
      weekKey,
      dayKey,
      dryRun,
      triggeredBy,
      message: "Weekly auto-run is disabled in alert settings.",
      settings,
    };
  }

  if (force) {
    await supabaseAdmin
      .from("consumables_alert_batches")
      .delete()
      .eq("week_key", weekKey);
  } else {
    const { data: existingBatch, error: batchErr } = await supabaseAdmin
      .from("consumables_alert_batches")
      .select("*")
      .eq("week_key", weekKey)
      .maybeSingle();
    if (batchErr) throw batchErr;

    if (existingBatch) {
      return {
        ok: true,
        skipped: true,
        reason: "already_reported",
        weekKey,
        dayKey,
        batch: existingBatch,
        dryRun,
        triggeredBy,
        settings,
      };
    }
  }

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("consumables")
    .select(
      "id,name,sku,quantity,min_level,unit,category,bin_location,is_active",
    )
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (itemsErr) throw itemsErr;

  const list = items ?? [];
  if (list.length === 0) {
    const { data: emptyBatch, error: emptyErr } = await supabaseAdmin
      .from("consumables_alert_batches")
      .insert({
        week_key: weekKey,
        status: "empty_skipped",
        item_count: 0,
        out_of_stock_count: 0,
        below_minimum_count: 0,
        approaching_count: 0,
        good_count: 0,
        jira_issue_key: "",
        jira_issue_url: "",
        slack_channel_id: "",
        slack_message_ts: "",
        dry_run: dryRun,
        error_message: "",
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (emptyErr) throw emptyErr;

    return {
      ok: true,
      skipped: true,
      reason: "no_items",
      weekKey,
      dayKey,
      batch: emptyBatch,
      dryRun,
      triggeredBy,
      settings,
      message: "No active consumables — Jira and Slack skipped.",
    };
  }

  // Local destage: auto dry-run only when BOTH integrations lack live config.
  // Partial config fails loudly below (do not silently skip a real Slack post).
  if (!dryRun && isDevAuthEnabled()) {
    const liveJira = jiraConfigStatus({
      projectKey: routing.jiraProjectKey,
      issueType: routing.jiraIssueType,
      dryRun: false,
    });
    const liveSlack = slackConfigStatus({
      channelId: routing.slackChannelId,
      pingUserId: routing.slackPingUserId,
      dryRun: false,
    });
    if (!liveJira.configured && !liveSlack.configured) {
      dryRun = true;
    }
  }

  const jiraProjectKey =
    routing.jiraProjectKey || (dryRun ? "WH" : "");
  const slackChannelId =
    routing.slackChannelId || (dryRun ? "C-DRY-RUN" : "");

  const jiraStatus = jiraConfigStatus({
    projectKey: jiraProjectKey,
    issueType: routing.jiraIssueType,
    dryRun,
  });
  const slackStatus = slackConfigStatus({
    channelId: slackChannelId,
    pingUserId: routing.slackPingUserId,
    dryRun,
  });

  if (!jiraStatus.configured || !slackStatus.configured) {
    const missing = [
      ...(jiraStatus.missing ?? []),
      ...(slackStatus.missing ?? []),
    ];
    throw new Error(
      `Consumables alerts blocked — missing configuration: ${missing.join(", ")}. ` +
        `Set env vars or enable PROCUREMENT_DRY_RUN=true / CONSUMABLES_ALERTS_DRY_RUN=true for local testing.`,
    );
  }

  const report = buildConsumablesReport(list, {
    approachingRatio: settings.approaching_ratio,
  });
  const ticket = renderConsumablesAlertTicket({
    weekKey,
    dayKey,
    report,
    settings,
  });

  const issue = await createJiraIssue({
    summary: ticket.summary,
    description: ticket.description,
    projectKey: jiraProjectKey,
    issueType: routing.jiraIssueType,
    dryRun,
  });

  const slackText = buildConsumablesAlertsSlackText({
    weekKey,
    issueKey: issue.key,
    issueUrl: issue.url,
    counts: report.counts,
  });

  const slack = await postSlackMessage({
    channelId: slackChannelId,
    pingUserId: routing.slackPingUserId,
    text: slackText,
    dryRun,
  });

  const now = new Date().toISOString();
  const { data: batch, error: insertBatchErr } = await supabaseAdmin
    .from("consumables_alert_batches")
    .insert({
      week_key: weekKey,
      status: "submitted",
      item_count: report.counts.total,
      out_of_stock_count: report.counts.out_of_stock,
      below_minimum_count: report.counts.below_minimum,
      approaching_count: report.counts.approaching,
      good_count: report.counts.good,
      jira_issue_key: issue.key,
      jira_issue_url: issue.url,
      slack_channel_id: slack.channel,
      slack_message_ts: slack.ts,
      dry_run: Boolean(issue.dryRun || slack.dryRun || dryRun),
      error_message: "",
      submitted_at: now,
    })
    .select()
    .single();
  if (insertBatchErr) throw insertBatchErr;

  return {
    ok: true,
    skipped: false,
    reason: "submitted",
    weekKey,
    dayKey,
    batch,
    issue,
    slack,
    counts: report.counts,
    report,
    ticket,
    settings,
    schedule: consumablesAlertsScheduleLabelFromSettings(settings),
    dryRun: Boolean(issue.dryRun || slack.dryRun || dryRun),
    triggeredBy,
  };
}
