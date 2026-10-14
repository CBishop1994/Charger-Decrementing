/**
 * Slack Web API client for Warehouse Procurement service bot.
 *
 * Env:
 *   SLACK_BOT_TOKEN     — xoxb-… bot token (chat:write, users:read optional)
 *   SLACK_CHANNEL_ID    — default channel for procurement alerts
 *   SLACK_PING_USER_ID  — Slack member ID to @mention (U…)
 *   PROCUREMENT_DRY_RUN=true — skip HTTP, return fake ts
 */

export function getSlackConfig(overrides = {}) {
  const botToken = String(process.env.SLACK_BOT_TOKEN ?? "").trim();
  const channelId = String(
    overrides.channelId || process.env.SLACK_CHANNEL_ID || "",
  ).trim();
  const pingUserId = String(
    overrides.pingUserId || process.env.SLACK_PING_USER_ID || "",
  ).trim();
  const envDryRun =
    String(process.env.PROCUREMENT_DRY_RUN ?? "").toLowerCase() === "true";
  // Explicit override (including false) wins so callers can probe live config
  // while PROCUREMENT_DRY_RUN=true, and pipelines can force live/dry-run.
  const dryRun =
    overrides.dryRun !== undefined && overrides.dryRun !== null
      ? Boolean(overrides.dryRun)
      : envDryRun;

  return { botToken, channelId, pingUserId, dryRun, envDryRun };
}

export function slackConfigStatus(overrides = {}) {
  const cfg = getSlackConfig(overrides);
  const missing = [];
  if (!cfg.dryRun) {
    if (!cfg.botToken) missing.push("SLACK_BOT_TOKEN");
    if (!cfg.channelId) missing.push("SLACK_CHANNEL_ID");
  } else if (!cfg.channelId) {
    missing.push("SLACK_CHANNEL_ID");
  }
  const warnings = [];
  if (cfg.botToken && !cfg.botToken.startsWith("xoxb-")) {
    warnings.push(
      "SLACK_BOT_TOKEN should be a Bot User OAuth Token starting with xoxb-",
    );
  }
  return {
    configured: missing.length === 0,
    missing,
    dryRun: cfg.dryRun,
    channelId: cfg.channelId || null,
    pingUserId: cfg.pingUserId || null,
    warnings,
    tokenPresent: Boolean(cfg.botToken),
    tokenLooksValid: !cfg.botToken || cfg.botToken.startsWith("xoxb-"),
  };
}

/**
 * @param {{ channelId?: string, pingUserId?: string, text: string, dryRun?: boolean }} input
 * @returns {Promise<{ ok: true, channel: string, ts: string, dryRun: boolean }>}
 */
export async function postSlackMessage(input) {
  const cfg = getSlackConfig({
    channelId: input.channelId,
    pingUserId: input.pingUserId,
    dryRun: input.dryRun,
  });

  if (!cfg.channelId) {
    throw new Error("Slack channel ID is not configured");
  }

  const mention = cfg.pingUserId ? `<@${cfg.pingUserId}> ` : "";
  const text = `${mention}${String(input.text ?? "").trim()}`.trim();

  if (cfg.dryRun) {
    return {
      ok: true,
      channel: cfg.channelId,
      ts: `dry-run.${Date.now()}`,
      dryRun: true,
    };
  }

  if (!cfg.botToken) {
    throw new Error("Slack is not configured. Set SLACK_BOT_TOKEN.");
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: cfg.channelId,
      text,
      unfurl_links: true,
      unfurl_media: false,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    const err = data?.error || res.statusText || "unknown_error";
    throw new Error(`Slack chat.postMessage failed: ${err}`);
  }

  return {
    ok: true,
    channel: String(data.channel ?? cfg.channelId),
    ts: String(data.ts ?? ""),
    dryRun: false,
  };
}

/**
 * Build the procurement alert text (ticket link + ping handled in postSlackMessage).
 * @param {{ dayKey: string, issueKey: string, issueUrl: string, lineCount: number }} opts
 */
export function buildProcurementSlackText(opts) {
  const key = opts.issueKey || "ticket";
  const url = opts.issueUrl || "";
  const linkPart = url ? `<${url}|${key}>` : key;
  return (
    `Warehouse procurement order placed for ${opts.dayKey} ` +
    `(${opts.lineCount} line${opts.lineCount === 1 ? "" : "s"}). ` +
    `Jira: ${linkPart}`
  );
}
