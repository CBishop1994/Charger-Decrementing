/**
 * Shared dry-run resolution for Warehouse Procurement + Consumables alerts.
 *
 * Precedence:
 *   1. Explicit request/body dry_run (true|false)
 *   2. PROCUREMENT_DRY_RUN / feature env flag
 *   3. Local destage auto dry-run only when BOTH Jira and Slack lack live config
 *
 * Partial live config (e.g. Slack filled, Jira empty) does NOT auto dry-run —
 * the caller should fail with missing_* so the Admin UI cannot claim a real post.
 */

import { isDevAuthEnabled } from "./dev-auth.js";
import { jiraConfigStatus } from "./jira-client.js";
import { slackConfigStatus } from "./slack-client.js";

export function envFlagTrue(name) {
  return String(process.env[name] ?? "")
    .trim()
    .toLowerCase() === "true";
}

export function envProcurementDryRun() {
  return envFlagTrue("PROCUREMENT_DRY_RUN");
}

/**
 * @param {{
 *   requestDryRun?: boolean | null,
 *   envDryRun?: boolean,
 *   jiraProjectKey?: string,
 *   jiraIssueType?: string,
 *   slackChannelId?: string,
 *   slackPingUserId?: string,
 * }} [opts]
 */
export function resolveIntegrationDryRun(opts = {}) {
  const envDryRun =
    opts.envDryRun != null ? Boolean(opts.envDryRun) : envProcurementDryRun();

  let dryRun =
    opts.requestDryRun != null ? Boolean(opts.requestDryRun) : envDryRun;
  /** @type {string} */
  let reason =
    opts.requestDryRun != null
      ? dryRun
        ? "request"
        : "request_live"
      : envDryRun
        ? "env"
        : "live";

  const liveJira = jiraConfigStatus({
    projectKey: opts.jiraProjectKey,
    issueType: opts.jiraIssueType,
    dryRun: false,
  });
  const liveSlack = slackConfigStatus({
    channelId: opts.slackChannelId,
    pingUserId: opts.slackPingUserId,
    dryRun: false,
  });

  const missingLive = [
    ...(liveJira.missing ?? []),
    ...(liveSlack.missing ?? []),
  ];

  if (!dryRun && isDevAuthEnabled()) {
    if (!liveJira.configured && !liveSlack.configured) {
      dryRun = true;
      reason = "auto_missing_config";
    } else if (!liveJira.configured || !liveSlack.configured) {
      reason = "live_partial_config";
    }
  }

  return {
    dryRun,
    reason,
    envDryRun,
    missingLive,
    liveJira,
    liveSlack,
  };
}

/**
 * Status payload helpers for Admin / Procurement UI.
 * @param {ReturnType<typeof resolveIntegrationDryRun>} resolved
 * @param {{ jiraProjectKey?: string, jiraIssueType?: string, slackChannelId?: string, slackPingUserId?: string }} routing
 */
export function buildIntegrationsStatus(resolved, routing = {}) {
  const jira = jiraConfigStatus({
    projectKey: routing.jiraProjectKey,
    issueType: routing.jiraIssueType,
    dryRun: resolved.dryRun,
  });
  const slack = slackConfigStatus({
    channelId: routing.slackChannelId,
    pingUserId: routing.slackPingUserId,
    dryRun: resolved.dryRun,
  });

  return {
    jira,
    slack,
    dry_run: resolved.dryRun,
    dry_run_reason: resolved.reason,
    env_dry_run: resolved.envDryRun,
    missing_live: resolved.missingLive,
    mode: resolved.dryRun ? "dry-run" : "live",
  };
}
