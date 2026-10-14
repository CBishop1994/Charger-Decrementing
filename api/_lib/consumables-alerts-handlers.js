/**
 * HTTP handlers for weekly consumables alerts (mounted from api/inventory.ts).
 */

import { sendDbError } from "./errors.js";
import { supabaseAdmin } from "./supabase-admin.js";
import { denverDayKey } from "./denver-day.js";
import {
  buildConsumablesReport,
  denverWeekKey,
  runConsumablesWeeklyAlerts,
} from "./consumables-alerts.js";
import {
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
  normalizeHourMst,
  normalizeWeekday,
  resolveConsumablesAlertsRoutingFromSettings,
  serializeAlertSettings,
} from "./consumables-alert-settings.js";
import {
  buildIntegrationsStatus,
  resolveIntegrationDryRun,
} from "./integration-dry-run.js";

/**
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 * @param {{ email: string, name: string | null, isAdmin: boolean }} auth
 * @param {string} action
 */
export async function handleConsumablesAlerts(req, res, auth, action) {
  if (action === "run" || qAction(req) === "run") {
    return handleRun(req, res, auth);
  }

  if (action === "settings" || qAction(req) === "settings") {
    return handleSettings(req, res, auth);
  }

  if (action === "status" || qAction(req) === "status" || !action) {
    return handleStatus(req, res, auth);
  }

  return res.status(404).json({ error: "Unknown action", code: "NOT_FOUND" });
}

function qAction(req) {
  const a = req.query?.action;
  if (Array.isArray(a)) return String(a[0] ?? "");
  return String(a ?? "");
}

function emptyAlertCounts() {
  return {
    out_of_stock: 0,
    below_minimum: 0,
    approaching: 0,
    good: 0,
    total: 0,
    units_to_order: 0,
    skus_to_order: 0,
  };
}

/** Stable status shape so clients can always read integrations.dry_run / counts. */
function buildAlertsStatusPayload({
  weekKey,
  dayKey,
  locked = false,
  batch = null,
  history = [],
  counts = emptyAlertCounts(),
  routing = null,
  settings = null,
  items = [],
}) {
  const resolved = routing ?? {
    slackChannelId: "",
    slackPingUserId: "",
    jiraProjectKey: "",
    jiraIssueType: "Task",
    dryRunEnv: false,
  };
  const serialized =
    settings != null
      ? serializeAlertSettings(settings)
      : serializeAlertSettings({});
  return {
    week_key: weekKey,
    day_key: dayKey,
    schedule: consumablesAlertsScheduleLabelFromSettings(serialized),
    locked: Boolean(locked),
    batch: batch ?? null,
    history: Array.isArray(history) ? history : [],
    counts: {
      out_of_stock: Number(counts?.out_of_stock) || 0,
      below_minimum: Number(counts?.below_minimum) || 0,
      approaching: Number(counts?.approaching) || 0,
      good: Number(counts?.good) || 0,
      total: Number(counts?.total) || 0,
      units_to_order: Number(counts?.units_to_order) || 0,
      skus_to_order: Number(counts?.skus_to_order) || 0,
    },
    items: Array.isArray(items) ? items : [],
    settings: serialized,
    integrations: (() => {
      const dryResolved = resolveIntegrationDryRun({
        envDryRun: Boolean(resolved.dryRunEnv),
        jiraProjectKey: resolved.jiraProjectKey,
        jiraIssueType: resolved.jiraIssueType,
        slackChannelId: resolved.slackChannelId,
        slackPingUserId: resolved.slackPingUserId,
      });
      const base = buildIntegrationsStatus(dryResolved, {
        jiraProjectKey: resolved.jiraProjectKey,
        jiraIssueType: resolved.jiraIssueType,
        slackChannelId: resolved.slackChannelId,
        slackPingUserId: resolved.slackPingUserId,
      });
      return {
        ...base,
        routing: {
          slackChannelId: resolved.slackChannelId || null,
          slackPingUserId: resolved.slackPingUserId || null,
          jiraProjectKey: resolved.jiraProjectKey || null,
          jiraIssueType: resolved.jiraIssueType || "Task",
        },
      };
    })(),
  };
}

async function handleStatus(req, res, auth) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!auth) return;

  const weekKey = denverWeekKey();
  const dayKey = denverDayKey();

  try {
    const settingsRow = await ensureConsumablesAlertSettings();
    const settings = serializeAlertSettings(settingsRow);
    const routing = resolveConsumablesAlertsRoutingFromSettings(settingsRow);

    const { data: batch } = await supabaseAdmin
      .from("consumables_alert_batches")
      .select("*")
      .eq("week_key", weekKey)
      .maybeSingle();

    const { data: historyRows } = await supabaseAdmin
      .from("consumables_alert_batches")
      .select("*")
      .order("week_key", { ascending: false })
      .limit(12);

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("consumables")
      .select(
        "id,name,sku,quantity,min_level,unit,category,bin_location,is_active",
      )
      .eq("is_active", true);
    if (itemsErr) return sendDbError(res, itemsErr);

    const report = buildConsumablesReport(items ?? [], {
      approachingRatio: settings.approaching_ratio,
    });

    return res.status(200).json(
      buildAlertsStatusPayload({
        weekKey,
        dayKey,
        locked: Boolean(batch),
        batch: batch ?? null,
        history: historyRows ?? [],
        counts: report.counts,
        routing,
        settings,
        items: report.items,
      }),
    );
  } catch (err) {
    // Still return a stable shape so the dashboard never crashes on missing fields.
    console.error("[consumables-alerts/status]", err);
    return res.status(200).json(
      buildAlertsStatusPayload({
        weekKey,
        dayKey,
        locked: false,
        batch: null,
        counts: emptyAlertCounts(),
        routing: null,
        settings: null,
        items: [],
      }),
    );
  }
}

async function handleSettings(req, res, auth) {
  if (req.method === "GET") {
    if (!auth) return;
    try {
      const row = await ensureConsumablesAlertSettings();
      const settings = serializeAlertSettings(row);
      const routing = resolveConsumablesAlertsRoutingFromSettings(row);
      return res.status(200).json({
        ...settings,
        schedule: consumablesAlertsScheduleLabelFromSettings(settings),
        resolved: {
          ...routing,
          schedule: consumablesAlertsScheduleLabelFromSettings(settings),
        },
      });
    } catch (err) {
      return sendDbError(res, err);
    }
  }

  if (req.method === "PATCH") {
    if (!auth?.isAdmin) {
      return res
        .status(403)
        .json({ error: "Admin access required", code: "FORBIDDEN" });
    }
    try {
      await ensureConsumablesAlertSettings();
      const body = req.body ?? {};
      const patch = {};

      if (body.approaching_ratio !== undefined) {
        patch.approaching_ratio = normalizeApproachingRatio(
          body.approaching_ratio,
        );
      }
      if (body.weekly_enabled !== undefined) {
        patch.weekly_enabled = Boolean(body.weekly_enabled);
      }
      if (body.include_out_of_stock !== undefined) {
        patch.include_out_of_stock = Boolean(body.include_out_of_stock);
      }
      if (body.include_below_minimum !== undefined) {
        patch.include_below_minimum = Boolean(body.include_below_minimum);
      }
      if (body.include_approaching !== undefined) {
        patch.include_approaching = Boolean(body.include_approaching);
      }
      if (body.include_good !== undefined) {
        patch.include_good = Boolean(body.include_good);
      }
      if (body.schedule_weekday !== undefined) {
        patch.schedule_weekday = normalizeWeekday(body.schedule_weekday, 1);
      }
      if (body.schedule_hour_mst !== undefined) {
        patch.schedule_hour_mst = normalizeHourMst(body.schedule_hour_mst, 8);
      }
      if (body.slack_channel_id !== undefined) {
        patch.slack_channel_id = String(body.slack_channel_id ?? "").trim();
      }
      if (body.slack_ping_user_id !== undefined) {
        patch.slack_ping_user_id = String(body.slack_ping_user_id ?? "").trim();
      }
      if (body.jira_project_key !== undefined) {
        patch.jira_project_key = String(body.jira_project_key ?? "").trim();
      }
      if (body.jira_issue_type !== undefined) {
        patch.jira_issue_type = String(body.jira_issue_type ?? "").trim();
      }
      if (body.jira_summary_template !== undefined) {
        const v = String(body.jira_summary_template ?? "").trim();
        patch.jira_summary_template = v || DEFAULT_JIRA_SUMMARY;
      }
      if (body.jira_intro_template !== undefined) {
        const v = String(body.jira_intro_template ?? "").trim();
        patch.jira_intro_template = v || DEFAULT_JIRA_INTRO;
      }
      if (body.jira_section_heading_template !== undefined) {
        const v = String(body.jira_section_heading_template ?? "").trim();
        patch.jira_section_heading_template = v || DEFAULT_JIRA_SECTION_HEADING;
      }
      if (body.jira_item_line_template !== undefined) {
        const v = String(body.jira_item_line_template ?? "").trim();
        patch.jira_item_line_template = v || DEFAULT_JIRA_ITEM_LINE;
      }
      if (body.jira_empty_section_template !== undefined) {
        const v = String(body.jira_empty_section_template ?? "").trim();
        patch.jira_empty_section_template = v || DEFAULT_JIRA_EMPTY_SECTION;
      }
      if (body.jira_footer_template !== undefined) {
        const v = String(body.jira_footer_template ?? "").trim();
        patch.jira_footer_template = v || DEFAULT_JIRA_FOOTER;
      }
      if (body.jira_description_template !== undefined) {
        const v = String(body.jira_description_template ?? "").trim();
        patch.jira_description_template = v || DEFAULT_JIRA_DESCRIPTION;
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      patch.updated_by = auth.email;
      patch.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from("consumables_alert_settings")
        .update(patch)
        .eq("id", 1)
        .select()
        .single();
      if (error) return sendDbError(res, error);

      const settings = serializeAlertSettings(data);
      const routing = resolveConsumablesAlertsRoutingFromSettings(data);
      return res.status(200).json({
        ...settings,
        schedule: consumablesAlertsScheduleLabelFromSettings(settings),
        resolved: {
          ...routing,
          schedule: consumablesAlertsScheduleLabelFromSettings(settings),
        },
      });
    } catch (err) {
      return sendDbError(res, err);
    }
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleRun(req, res, auth) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.isAdmin) {
    return res
      .status(403)
      .json({ error: "Admin access required", code: "FORBIDDEN" });
  }

  try {
    const body = req.body ?? {};
    const result = await runConsumablesWeeklyAlerts({
      weekKey: body.week_key ? String(body.week_key) : undefined,
      dryRun:
        body.dry_run != null ? Boolean(body.dry_run) : undefined,
      force: Boolean(body.force),
      triggeredBy: `admin:${auth.email}`,
    });
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message, code: "ALERTS_FAILED" });
  }
}
