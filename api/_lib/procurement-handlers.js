/**
 * HTTP handlers for Warehouse Procurement (mounted from api/inventory.ts).
 */

import { sendDbError } from "./errors.js";
import { supabaseAdmin } from "./supabase-admin.js";
import {
  denverDayKey,
  isPastProcurementClose,
  nextDenverDayKey,
  procurementCloseScheduleLabel,
} from "./denver-day.js";
import { runProcurementClose } from "./procurement-close.js";
import {
  ensureProcurementSettings,
  resolveProcurementRouting,
} from "./procurement-settings.js";
import {
  DEFAULT_JIRA_DESCRIPTION,
  DEFAULT_JIRA_SUMMARY,
} from "./procurement-template.js";
import {
  buildIntegrationsStatus,
  resolveIntegrationDryRun,
} from "./integration-dry-run.js";
import { jiraConfigStatus } from "./jira-client.js";
import { slackConfigStatus } from "./slack-client.js";

/**
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 * @param {{ email: string, name: string | null, isAdmin: boolean }} auth
 * @param {number | null} id
 * @param {string} action
 */
export async function handleProcurement(req, res, auth, id, action) {
  const dayKey = denverDayKey();

  // POST /api/procurement/close — admin/dev manual close (also used after cron auth)
  if (action === "close" || (req.method === "POST" && !id && qAction(req) === "close")) {
    return handleClose(req, res, auth);
  }

  // GET/PATCH /api/procurement/settings
  if (action === "settings" || (!id && qAction(req) === "settings")) {
    return handleSettings(req, res, auth);
  }

  // GET /api/procurement/status — day status + integration health
  if (action === "status" || (!id && qAction(req) === "status")) {
    return handleStatus(req, res, auth);
  }

  // Collection / item CRUD on order lines
  if (id != null) {
    return handleLineById(req, res, auth, id, dayKey);
  }

  if (req.method === "GET") {
    const locked = await isDayLocked(dayKey);
    const queueDay = locked ? nextDenverDayKey(dayKey) : dayKey;
    const hasExplicitDay =
      req.query?.day_key != null && String(req.query.day_key).trim() !== "";
    const filterDay = hasExplicitDay
      ? String(req.query.day_key).trim()
      : queueDay;
    const { data, error } = await supabaseAdmin
      .from("procurement_order_lines")
      .select("*")
      .eq("day_key", filterDay)
      .order("created_at", { ascending: true });
    if (error) return sendDbError(res, error);
    return res.status(200).json(data ?? []);
  }

  if (req.method === "POST") {
    // After today's close, queue new lines onto the next Denver calendar day.
    const locked = await isDayLocked(dayKey);
    const targetDay = locked ? nextDenverDayKey(dayKey) : dayKey;
    if (await isDayLocked(targetDay)) {
      return res.status(409).json({
        error:
          "That procurement day is already closed. Try again on the next open Denver day.",
        code: "DAY_CLOSED",
        day_key: targetDay,
      });
    }

    const body = req.body ?? {};
    const link = String(body.link ?? "").trim();
    const quantity = Number(body.quantity);
    const notes = String(body.notes ?? "").trim();

    if (!link) {
      return res.status(400).json({ error: "A product link is required" });
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      return res.status(400).json({ error: "Quantity must be a positive integer" });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("procurement_order_lines")
      .insert({
        day_key: targetDay,
        link,
        quantity,
        notes,
        created_by_email: auth.email,
        created_by_name: String(auth.name ?? "").trim(),
        status: "open",
        batch_id: null,
        submitted_at: null,
        updated_at: now,
        created_at: now,
      })
      .select()
      .single();
    if (error) return sendDbError(res, error);
    return res.status(201).json(data);
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}

function qAction(req) {
  const a = req.query?.action;
  if (Array.isArray(a)) return String(a[0] ?? "");
  return String(a ?? "");
}

async function isDayLocked(dayKey) {
  const { data, error } = await supabaseAdmin
    .from("procurement_batches")
    .select("id,status")
    .eq("day_key", dayKey)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function handleLineById(req, res, auth, id, dayKey) {
  const { data: existing, error: loadErr } = await supabaseAdmin
    .from("procurement_order_lines")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return sendDbError(res, loadErr);
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (req.method === "GET") {
    return res.status(200).json(existing);
  }

  const isOwner =
    String(existing.created_by_email ?? "").toLowerCase() ===
    String(auth.email ?? "").toLowerCase();
  if (!auth.isAdmin && !isOwner) {
    return res.status(403).json({
      error: "You can only edit your own procurement lines",
      code: "FORBIDDEN",
    });
  }

  if (existing.status !== "open") {
    return res.status(409).json({
      error: "This line has already been submitted and cannot be edited",
      code: "LINE_LOCKED",
    });
  }

  if (await isDayLocked(existing.day_key || dayKey)) {
    return res.status(409).json({
      error: "Today's procurement window is closed",
      code: "DAY_CLOSED",
    });
  }

  if (req.method === "PATCH") {
    const body = req.body ?? {};
    const patch = {};
    if (body.link !== undefined) {
      const link = String(body.link ?? "").trim();
      if (!link) return res.status(400).json({ error: "Link cannot be empty" });
      patch.link = link;
    }
    if (body.quantity !== undefined) {
      const quantity = Number(body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
        return res.status(400).json({ error: "Quantity must be a positive integer" });
      }
      patch.quantity = quantity;
    }
    if (body.notes !== undefined) {
      patch.notes = String(body.notes ?? "").trim();
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("procurement_order_lines")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) return sendDbError(res, error);
    return res.status(200).json(data);
  }

  if (req.method === "DELETE") {
    const { error } = await supabaseAdmin
      .from("procurement_order_lines")
      .delete()
      .eq("id", id);
    if (error) return sendDbError(res, error);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleSettings(req, res, auth) {
  if (req.method === "GET") {
    if (!auth) return;
    const settings = await ensureProcurementSettings();
    const routing = resolveProcurementRouting(settings);
    return res.status(200).json({
      ...settings,
      resolved: {
        ...routing,
        close_schedule: procurementCloseScheduleLabel(),
        day_key: denverDayKey(),
        past_close: isPastProcurementClose(),
        jira: jiraConfigStatus({
          projectKey: routing.jiraProjectKey,
          issueType: routing.jiraIssueType,
        }),
        slack: slackConfigStatus({
          channelId: routing.slackChannelId,
          pingUserId: routing.slackPingUserId,
        }),
      },
    });
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    if (!auth.isAdmin) {
      return res
        .status(403)
        .json({ error: "Admin access required", code: "FORBIDDEN" });
    }
    await ensureProcurementSettings();
    const body = req.body ?? {};
    const patch = {};
    if (body.jira_summary_template !== undefined) {
      const v = String(body.jira_summary_template ?? "").trim();
      patch.jira_summary_template = v || DEFAULT_JIRA_SUMMARY;
    }
    if (body.jira_description_template !== undefined) {
      const v = String(body.jira_description_template ?? "").trim();
      patch.jira_description_template = v || DEFAULT_JIRA_DESCRIPTION;
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
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }
    patch.updated_by = auth.email;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("procurement_settings")
      .update(patch)
      .eq("id", 1)
      .select()
      .single();
    if (error) return sendDbError(res, error);
    return res.status(200).json(data);
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleStatus(req, res, auth) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!auth) return;

  const dayKey = denverDayKey();
  const settings = await ensureProcurementSettings();
  const routing = resolveProcurementRouting(settings);

  const { data: batch } = await supabaseAdmin
    .from("procurement_batches")
    .select("*")
    .eq("day_key", dayKey)
    .maybeSingle();

  const { data: historyRows } = await supabaseAdmin
    .from("procurement_batches")
    .select("*")
    .order("day_key", { ascending: false })
    .limit(12);

  const locked = Boolean(batch);
  const queueDayKey = locked ? nextDenverDayKey(dayKey) : dayKey;

  const { data: todayLines, error: todayErr } = await supabaseAdmin
    .from("procurement_order_lines")
    .select("id,status")
    .eq("day_key", dayKey);
  if (todayErr) return sendDbError(res, todayErr);

  let queueLines = todayLines;
  if (queueDayKey !== dayKey) {
    const { data: queued, error: queueErr } = await supabaseAdmin
      .from("procurement_order_lines")
      .select("id,status")
      .eq("day_key", queueDayKey);
    if (queueErr) return sendDbError(res, queueErr);
    queueLines = queued;
  }

  const openCount = (queueLines ?? []).filter((l) => l.status === "open").length;
  const submittedCount = (todayLines ?? []).filter(
    (l) => l.status === "submitted",
  ).length;

  const resolvedDry = resolveIntegrationDryRun({
    jiraProjectKey: routing.jiraProjectKey,
    jiraIssueType: routing.jiraIssueType,
    slackChannelId: routing.slackChannelId,
    slackPingUserId: routing.slackPingUserId,
  });

  return res.status(200).json({
    day_key: dayKey,
    queue_day_key: queueDayKey,
    past_close: isPastProcurementClose(),
    close_schedule: procurementCloseScheduleLabel(),
    locked,
    batch: batch ?? null,
    history: historyRows ?? [],
    open_count: openCount,
    submitted_count: submittedCount,
    integrations: buildIntegrationsStatus(resolvedDry, {
      jiraProjectKey: routing.jiraProjectKey,
      jiraIssueType: routing.jiraIssueType,
      slackChannelId: routing.slackChannelId,
      slackPingUserId: routing.slackPingUserId,
    }),
  });
}

async function handleClose(req, res, auth) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Cron uses Bearer CRON_SECRET and may call without session; inventory
  // router always requires session. Manual close requires admin.
  // Cron endpoint lives at api/cron/procurement-close.ts.
  if (!auth.isAdmin) {
    return res
      .status(403)
      .json({ error: "Admin access required", code: "FORBIDDEN" });
  }

  try {
    const body = req.body ?? {};
    const result = await runProcurementClose({
      dayKey: body.day_key ? String(body.day_key) : undefined,
      dryRun:
        body.dry_run != null
          ? Boolean(body.dry_run)
          : undefined,
      triggeredBy: `admin:${auth.email}`,
    });
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message, code: "CLOSE_FAILED" });
  }
}

/**
 * Seed a few open procurement lines + default settings for local destage.
 * @param {boolean} force
 */
export async function seedProcurementDemo(force = false) {
  await ensureProcurementSettings();

  const dayKey = denverDayKey();
  const { count, error: countErr } = await supabaseAdmin
    .from("procurement_order_lines")
    .select("id", { count: "exact", head: true })
    .eq("day_key", dayKey)
    .eq("status", "open");
  if (countErr) throw countErr;

  if ((count ?? 0) > 0 && !force) {
    return { skipped: true, lines: count ?? 0 };
  }

  if (force) {
    await supabaseAdmin
      .from("procurement_order_lines")
      .delete()
      .eq("day_key", dayKey);
    await supabaseAdmin.from("procurement_batches").delete().eq("day_key", dayKey);
  }

  const now = new Date().toISOString();
  const demo = [
    {
      day_key: dayKey,
      link: "https://www.grainger.com/product/example-nitrile-gloves",
      quantity: 4,
      notes: "Size L — receiving dock",
      created_by_email: "dev@localhost",
      created_by_name: "Local Dev",
      status: "open",
      updated_at: now,
      created_at: now,
    },
    {
      day_key: dayKey,
      link: "https://www.mcmaster.com/example-zip-ties",
      quantity: 2,
      notes: "",
      created_by_email: "dev@localhost",
      created_by_name: "Local Dev",
      status: "open",
      updated_at: now,
      created_at: now,
    },
  ];

  const { data, error } = await supabaseAdmin
    .from("procurement_order_lines")
    .insert(demo)
    .select("id");
  if (error) throw error;
  return { skipped: false, lines: data?.length ?? 0 };
}
