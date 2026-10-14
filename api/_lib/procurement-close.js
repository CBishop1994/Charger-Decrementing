/**
 * Daily warehouse procurement close pipeline.
 *
 * Idempotent per America/Denver day_key:
 *  - If a batch already exists → return already_done
 *  - If no open lines → record empty_skipped (no Jira, no Slack)
 *  - Else create one Jira issue, post Slack with ping, mark lines submitted
 */

import { supabaseAdmin } from "./supabase-admin.js";
import { denverDayKey } from "./denver-day.js";
import {
  ensureProcurementSettings,
  resolveProcurementRouting,
} from "./procurement-settings.js";
import { renderProcurementTicket } from "./procurement-template.js";
import { createJiraIssue, jiraConfigStatus } from "./jira-client.js";
import {
  buildProcurementSlackText,
  postSlackMessage,
  slackConfigStatus,
} from "./slack-client.js";
import { resolveIntegrationDryRun } from "./integration-dry-run.js";

/**
 * @param {{ dayKey?: string, dryRun?: boolean, triggeredBy?: string }} [opts]
 */
export async function runProcurementClose(opts = {}) {
  const dayKey = String(opts.dayKey || denverDayKey()).trim();
  const triggeredBy = String(opts.triggeredBy ?? "cron").trim() || "cron";

  const settingsEarly = await ensureProcurementSettings();
  const routingEarly = resolveProcurementRouting(settingsEarly);
  const resolvedDry = resolveIntegrationDryRun({
    requestDryRun: opts.dryRun,
    jiraProjectKey: routingEarly.jiraProjectKey,
    jiraIssueType: routingEarly.jiraIssueType,
    slackChannelId: routingEarly.slackChannelId,
    slackPingUserId: routingEarly.slackPingUserId,
  });
  let dryRun = resolvedDry.dryRun;
  let dryRunReason = resolvedDry.reason;

  const { data: existingBatch, error: batchErr } = await supabaseAdmin
    .from("procurement_batches")
    .select("*")
    .eq("day_key", dayKey)
    .maybeSingle();
  if (batchErr) throw batchErr;

  // Idempotent: never double-submit the same Denver day.
  if (existingBatch) {
    return {
      ok: true,
      skipped: true,
      reason: "already_closed",
      dayKey,
      batch: existingBatch,
      dryRun,
      dryRunReason,
      mode: dryRun ? "dry-run" : "live",
      triggeredBy,
    };
  }

  const { data: openLines, error: linesErr } = await supabaseAdmin
    .from("procurement_order_lines")
    .select("*")
    .eq("day_key", dayKey)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (linesErr) throw linesErr;

  const lines = openLines ?? [];

  if (lines.length === 0) {
    const { data: emptyBatch, error: emptyErr } = await supabaseAdmin
      .from("procurement_batches")
      .insert({
        day_key: dayKey,
        status: "empty_skipped",
        line_count: 0,
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
      reason: "no_orders",
      dayKey,
      batch: emptyBatch,
      dryRun,
      dryRunReason,
      mode: dryRun ? "dry-run" : "live",
      triggeredBy,
      message: "No procurement orders for this day — Jira and Slack skipped.",
    };
  }

  const settings = settingsEarly;
  const routing = routingEarly;

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
      `Procurement close blocked — missing configuration: ${missing.join(", ")}. ` +
        `Set env vars or enable PROCUREMENT_DRY_RUN=true for local testing.`,
    );
  }

  if (slackStatus.warnings?.length) {
    console.warn(
      `[procurement-close] Slack config warnings: ${slackStatus.warnings.join("; ")}`,
    );
  }

  const ticket = renderProcurementTicket({
    summaryTemplate: String(settings.jira_summary_template ?? ""),
    descriptionTemplate: String(settings.jira_description_template ?? ""),
    dayKey,
    lines,
  });

  const issue = await createJiraIssue({
    summary: ticket.summary,
    description: ticket.description,
    projectKey: jiraProjectKey,
    issueType: routing.jiraIssueType,
    dryRun,
  });

  const slackText = buildProcurementSlackText({
    dayKey,
    issueKey: issue.key,
    issueUrl: issue.url,
    lineCount: lines.length,
  });

  const slack = await postSlackMessage({
    channelId: slackChannelId,
    pingUserId: routing.slackPingUserId,
    text: slackText,
    dryRun,
  });

  const now = new Date().toISOString();
  const { data: batch, error: insertBatchErr } = await supabaseAdmin
    .from("procurement_batches")
    .insert({
      day_key: dayKey,
      status: "submitted",
      line_count: lines.length,
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

  const lineIds = lines.map((l) => l.id);
  const { error: updErr } = await supabaseAdmin
    .from("procurement_order_lines")
    .update({
      status: "submitted",
      batch_id: batch.id,
      submitted_at: now,
      updated_at: now,
    })
    .in("id", lineIds);
  if (updErr) throw updErr;

  const effectiveDryRun = Boolean(issue.dryRun || slack.dryRun || dryRun);
  const slackPosted = Boolean(slack?.ok && !slack.dryRun && slack.ts);
  return {
    ok: true,
    skipped: false,
    reason: "submitted",
    dayKey,
    batch,
    issue,
    slack,
    lineCount: lines.length,
    dryRun: effectiveDryRun,
    dryRunReason,
    mode: effectiveDryRun ? "dry-run" : "live",
    slackPosted,
    message: effectiveDryRun
      ? `Dry-run (${dryRunReason}) — no real Jira issue or Slack message was posted.`
      : `Posted Slack message in ${slack.channel} (ts ${slack.ts}).`,
    triggeredBy,
    ticket,
  };
}
