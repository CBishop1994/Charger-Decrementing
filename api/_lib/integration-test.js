/**
 * Admin probes for Slack + Jira service bots.
 *
 * Modes:
 *   - auth:   Slack auth.test / Jira /myself (no channel message, no issue)
 *   - write:  Slack chat.postMessage + optional Jira createIssue ([TEST] markers)
 *
 * dry_run=true skips outbound HTTP and returns structured fake results.
 */

import { createJiraIssue, getJiraConfig, jiraConfigStatus } from "./jira-client.js";
import { getSlackConfig, postSlackMessage, slackConfigStatus } from "./slack-client.js";
import {
  buildIntegrationsStatus,
  resolveIntegrationDryRun,
} from "./integration-dry-run.js";

/**
 * @param {{ botToken: string }} cfg
 */
export async function probeSlackAuth(cfg) {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.botToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    const err = data?.error || res.statusText || "unknown_error";
    throw new Error(`Slack auth.test failed: ${err}`);
  }
  return {
    ok: true,
    team: String(data.team ?? ""),
    user: String(data.user ?? ""),
    bot_id: data.bot_id ? String(data.bot_id) : null,
    team_id: data.team_id ? String(data.team_id) : null,
  };
}

/**
 * @param {{ baseUrl: string, email: string, apiToken: string }} cfg
 */
export async function probeJiraAuth(cfg) {
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const endpoint = `${cfg.baseUrl}/rest/api/3/myself`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail =
      data?.errorMessages?.join?.("; ") ||
      (data?.errors && JSON.stringify(data.errors)) ||
      text ||
      res.statusText;
    throw new Error(`Jira /myself failed (${res.status}): ${detail}`);
  }
  return {
    ok: true,
    accountId: String(data?.accountId ?? ""),
    displayName: String(data?.displayName ?? ""),
    emailAddress: data?.emailAddress ? String(data.emailAddress) : null,
  };
}

/**
 * @param {{
 *   targets?: Array<"slack"|"jira"|"both">|string,
 *   mode?: "auth"|"write",
 *   dryRun?: boolean|null,
 *   slackChannelId?: string,
 *   slackPingUserId?: string,
 *   jiraProjectKey?: string,
 *   jiraIssueType?: string,
 * }} [opts]
 */
export async function runIntegrationTests(opts = {}) {
  const rawTargets = opts.targets ?? "both";
  const list = Array.isArray(rawTargets)
    ? rawTargets
    : String(rawTargets)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
  const wantBoth = list.includes("both") || list.length === 0;
  const wantSlack = wantBoth || list.includes("slack");
  const wantJira = wantBoth || list.includes("jira");
  const mode = opts.mode === "write" ? "write" : "auth";

  const resolved = resolveIntegrationDryRun({
    requestDryRun: opts.dryRun,
    slackChannelId: opts.slackChannelId,
    slackPingUserId: opts.slackPingUserId,
    jiraProjectKey: opts.jiraProjectKey,
    jiraIssueType: opts.jiraIssueType,
  });

  // Explicit dryRun:false means live probe even if env says dry-run.
  const dryRun =
    opts.dryRun === false
      ? false
      : opts.dryRun === true
        ? true
        : resolved.dryRun;

  const slackCfg = getSlackConfig({
    channelId: opts.slackChannelId,
    pingUserId: opts.slackPingUserId,
    dryRun,
  });
  const jiraCfg = getJiraConfig({
    projectKey: opts.jiraProjectKey,
    issueType: opts.jiraIssueType,
    dryRun,
  });

  /** @type {Record<string, unknown>} */
  const results = {
    mode,
    dry_run: dryRun,
    dry_run_reason:
      opts.dryRun === false
        ? "request_live"
        : opts.dryRun === true
          ? "request"
          : resolved.reason,
    integrations: buildIntegrationsStatus(
      { ...resolved, dryRun },
      {
        slackChannelId: slackCfg.channelId,
        slackPingUserId: slackCfg.pingUserId,
        jiraProjectKey: jiraCfg.projectKey,
        jiraIssueType: jiraCfg.issueType,
      },
    ),
    slack: null,
    jira: null,
    ok: true,
  };

  if (wantSlack) {
    const status = slackConfigStatus({
      channelId: slackCfg.channelId,
      pingUserId: slackCfg.pingUserId,
      dryRun: false,
    });
    try {
      if (dryRun) {
        results.slack = {
          ok: true,
          dry_run: true,
          step: mode,
          detail: "Dry-run — Slack HTTP skipped",
          config: status,
        };
      } else if (!slackCfg.botToken) {
        throw new Error("SLACK_BOT_TOKEN is not set");
      } else if (!slackCfg.botToken.startsWith("xoxb-")) {
        throw new Error(
          "SLACK_BOT_TOKEN must be a Bot User OAuth Token starting with xoxb-",
        );
      } else {
        const auth = await probeSlackAuth(slackCfg);
        let post = null;
        if (mode === "write") {
          if (!slackCfg.channelId) {
            throw new Error("SLACK_CHANNEL_ID is required for write test");
          }
          post = await postSlackMessage({
            channelId: slackCfg.channelId,
            pingUserId: slackCfg.pingUserId,
            text:
              "[TEST] Consumables app Slack integration probe. " +
              "Safe to ignore — confirms bot can post to this channel.",
            dryRun: false,
          });
        }
        results.slack = {
          ok: true,
          dry_run: false,
          step: mode,
          auth,
          post,
          config: status,
        };
      }
    } catch (err) {
      results.ok = false;
      results.slack = {
        ok: false,
        dry_run: dryRun,
        step: mode,
        error: err instanceof Error ? err.message : String(err),
        config: status,
      };
    }
  }

  if (wantJira) {
    const status = jiraConfigStatus({
      projectKey: jiraCfg.projectKey,
      issueType: jiraCfg.issueType,
      dryRun: false,
    });
    try {
      if (dryRun) {
        results.jira = {
          ok: true,
          dry_run: true,
          step: mode,
          detail: "Dry-run — Jira HTTP skipped",
          config: status,
        };
      } else if (!jiraCfg.baseUrl || !jiraCfg.email || !jiraCfg.apiToken) {
        throw new Error(
          "Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN for live Jira tests",
        );
      } else {
        const auth = await probeJiraAuth(jiraCfg);
        let issue = null;
        if (mode === "write") {
          if (!jiraCfg.projectKey) {
            throw new Error("JIRA_PROJECT_KEY is required for write test");
          }
          issue = await createJiraIssue({
            projectKey: jiraCfg.projectKey,
            issueType: jiraCfg.issueType,
            summary: `[TEST] Consumables integration probe ${new Date().toISOString().slice(0, 16)}`,
            description:
              "Automated integration test from the Consumables admin dashboard.\n" +
              "Safe to close/delete — confirms API token can create issues.",
            dryRun: false,
          });
        }
        results.jira = {
          ok: true,
          dry_run: false,
          step: mode,
          auth,
          issue,
          config: status,
        };
      }
    } catch (err) {
      results.ok = false;
      results.jira = {
        ok: false,
        dry_run: dryRun,
        step: mode,
        error: err instanceof Error ? err.message : String(err),
        config: status,
      };
    }
  }

  results.message = summarizeIntegrationTest(results);
  return results;
}

/**
 * @param {Record<string, unknown>} results
 */
export function summarizeIntegrationTest(results) {
  const parts = [];
  if (results.dry_run) parts.push("Dry-run (no outbound HTTP)");
  else parts.push("Live");

  const slack = results.slack;
  const jira = results.jira;
  if (slack && typeof slack === "object") {
    const s = /** @type {Record<string, unknown>} */ (slack);
    parts.push(s.ok ? "Slack OK" : `Slack FAIL: ${s.error}`);
  }
  if (jira && typeof jira === "object") {
    const j = /** @type {Record<string, unknown>} */ (jira);
    parts.push(j.ok ? "Jira OK" : `Jira FAIL: ${j.error}`);
  }
  return parts.join(" · ");
}
