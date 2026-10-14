/**
 * Load / ensure singleton consumables_alert_settings row (id=1).
 */

import { supabaseAdmin } from "./supabase-admin.js";

export const DEFAULT_APPROACHING_RATIO = 1.25;

export const DEFAULT_JIRA_SUMMARY =
  "Consumables weekly inventory {{week}}: {{out_count}} out, {{below_count}} below min, {{approaching_count}} approaching, {{good_count}} good";

export const DEFAULT_JIRA_INTRO =
  "Summary: {{out_count}} out of stock · {{below_count}} below minimum · {{approaching_count}} approaching · {{good_count}} good ({{total}} active items){{order_summary_clause}}";

export const DEFAULT_JIRA_SECTION_HEADING = "## {{title}} ({{count}})";

export const DEFAULT_JIRA_ITEM_LINE =
  "- {{name}}{{sku_part}}: {{qty}} {{unit}} on hand (min {{min}}){{on_order_part}}{{order_part}}{{bin_part}}";

export const DEFAULT_JIRA_EMPTY_SECTION = "(none)";

export const DEFAULT_JIRA_FOOTER =
  "Total additional quantity to order now: {{order_total}} units, after subtracting on-order stock (min × 2 target).";

/** Layout for description; pieces fill {{intro}}, {{sections}}, {{footer}}. */
export const DEFAULT_JIRA_DESCRIPTION =
  "{{intro}}\n\n{{sections}}\n\n{{footer}}";

export const DEFAULT_ALERT_SETTINGS = {
  approaching_ratio: DEFAULT_APPROACHING_RATIO,
  weekly_enabled: true,
  include_out_of_stock: true,
  include_below_minimum: true,
  include_approaching: true,
  include_good: true,
  schedule_weekday: 1,
  schedule_hour_mst: 8,
  slack_channel_id: "",
  slack_ping_user_id: "",
  jira_project_key: "",
  jira_issue_type: "",
  jira_summary_template: DEFAULT_JIRA_SUMMARY,
  jira_intro_template: DEFAULT_JIRA_INTRO,
  jira_section_heading_template: DEFAULT_JIRA_SECTION_HEADING,
  jira_item_line_template: DEFAULT_JIRA_ITEM_LINE,
  jira_empty_section_template: DEFAULT_JIRA_EMPTY_SECTION,
  jira_footer_template: DEFAULT_JIRA_FOOTER,
  jira_description_template: DEFAULT_JIRA_DESCRIPTION,
};

/**
 * Clamp approaching ratio to a sensible operator range.
 * @param {unknown} value
 */
export function normalizeApproachingRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_APPROACHING_RATIO;
  return Math.min(3, Math.max(1.01, Math.round(n * 100) / 100));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function normalizeWeekday(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 1 || i > 7) return fallback;
  return i;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function normalizeHourMst(value, fallback = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 0 || i > 23) return fallback;
  return i;
}

export async function ensureConsumablesAlertSettings() {
  const { data: existing, error } = await supabaseAdmin
    .from("consumables_alert_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data, error: insertErr } = await supabaseAdmin
    .from("consumables_alert_settings")
    .insert({
      id: 1,
      ...DEFAULT_ALERT_SETTINGS,
      updated_by: "system",
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertErr) {
    const { data: again, error: againErr } = await supabaseAdmin
      .from("consumables_alert_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (againErr) throw againErr;
    if (again) return again;
    throw insertErr;
  }
  return data;
}

/**
 * Resolved routing: DB overrides win when non-empty, else env
 * (consumables-specific env, then shared procurement env).
 * @param {Record<string, unknown>} settings
 */
export function resolveConsumablesAlertsRoutingFromSettings(settings) {
  const slackChannelId =
    String(settings?.slack_channel_id ?? "").trim() ||
    String(process.env.CONSUMABLES_SLACK_CHANNEL_ID ?? "").trim() ||
    String(process.env.SLACK_CHANNEL_ID ?? "").trim();
  const slackPingUserId =
    String(settings?.slack_ping_user_id ?? "").trim() ||
    String(process.env.CONSUMABLES_SLACK_PING_USER_ID ?? "").trim() ||
    String(process.env.SLACK_PING_USER_ID ?? "").trim();
  const jiraProjectKey =
    String(settings?.jira_project_key ?? "").trim() ||
    String(process.env.CONSUMABLES_JIRA_PROJECT_KEY ?? "").trim() ||
    String(process.env.JIRA_PROJECT_KEY ?? "").trim();
  const jiraIssueType =
    String(settings?.jira_issue_type ?? "").trim() ||
    String(process.env.CONSUMABLES_JIRA_ISSUE_TYPE ?? "").trim() ||
    String(process.env.JIRA_ISSUE_TYPE ?? "").trim() ||
    "Task";
  const dryRunEnv =
    String(process.env.CONSUMABLES_ALERTS_DRY_RUN ?? "").toLowerCase() ===
      "true" ||
    String(process.env.PROCUREMENT_DRY_RUN ?? "").toLowerCase() === "true";

  return {
    slackChannelId,
    slackPingUserId,
    jiraProjectKey,
    jiraIssueType,
    dryRunEnv,
  };
}

const WEEKDAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/**
 * Human schedule label from settings (America/Denver).
 * @param {Record<string, unknown>} settings
 */
export function consumablesAlertsScheduleLabelFromSettings(settings) {
  const weekday = normalizeWeekday(
    settings?.schedule_weekday,
    DEFAULT_ALERT_SETTINGS.schedule_weekday,
  );
  const hour = normalizeHourMst(
    settings?.schedule_hour_mst,
    DEFAULT_ALERT_SETTINGS.schedule_hour_mst,
  );
  const name = WEEKDAY_NAMES[weekday] || "Monday";
  const ampm = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const suffix = hour < 12 ? "am" : "pm";
  const enabled =
    settings?.weekly_enabled == null
      ? true
      : Boolean(settings.weekly_enabled);
  const base = `${name} ${ampm}:00${suffix} MST (America/Denver)`;
  return enabled ? base : `${base} · auto-run off`;
}

/**
 * Normalize settings row for API responses.
 * @param {Record<string, unknown>} row
 */
export function serializeAlertSettings(row) {
  return {
    id: Number(row?.id) || 1,
    approaching_ratio: normalizeApproachingRatio(row?.approaching_ratio),
    weekly_enabled:
      row?.weekly_enabled == null ? true : Boolean(row.weekly_enabled),
    include_out_of_stock:
      row?.include_out_of_stock == null
        ? true
        : Boolean(row.include_out_of_stock),
    include_below_minimum:
      row?.include_below_minimum == null
        ? true
        : Boolean(row.include_below_minimum),
    include_approaching:
      row?.include_approaching == null
        ? true
        : Boolean(row.include_approaching),
    include_good:
      row?.include_good == null ? true : Boolean(row.include_good),
    schedule_weekday: normalizeWeekday(row?.schedule_weekday, 1),
    schedule_hour_mst: normalizeHourMst(row?.schedule_hour_mst, 8),
    slack_channel_id: String(row?.slack_channel_id ?? ""),
    slack_ping_user_id: String(row?.slack_ping_user_id ?? ""),
    jira_project_key: String(row?.jira_project_key ?? ""),
    jira_issue_type: String(row?.jira_issue_type ?? ""),
    jira_summary_template:
      String(row?.jira_summary_template ?? "").trim() || DEFAULT_JIRA_SUMMARY,
    jira_intro_template:
      String(row?.jira_intro_template ?? "").trim() || DEFAULT_JIRA_INTRO,
    jira_section_heading_template:
      String(row?.jira_section_heading_template ?? "").trim() ||
      DEFAULT_JIRA_SECTION_HEADING,
    jira_item_line_template:
      String(row?.jira_item_line_template ?? "").trim() || DEFAULT_JIRA_ITEM_LINE,
    jira_empty_section_template:
      String(row?.jira_empty_section_template ?? "").trim() ||
      DEFAULT_JIRA_EMPTY_SECTION,
    jira_footer_template:
      String(row?.jira_footer_template ?? "").trim() || DEFAULT_JIRA_FOOTER,
    jira_description_template:
      String(row?.jira_description_template ?? "").trim() ||
      DEFAULT_JIRA_DESCRIPTION,
    updated_by: String(row?.updated_by ?? ""),
    updated_at: row?.updated_at ?? null,
    created_at: row?.created_at ?? null,
  };
}
