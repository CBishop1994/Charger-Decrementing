/**
 * Jira Cloud REST client for Warehouse Procurement service bot.
 * Uses Basic auth: email + API token (Atlassian account API token).
 *
 * Env:
 *   JIRA_BASE_URL   — e.g. https://your-domain.atlassian.net
 *   JIRA_EMAIL
 *   JIRA_API_TOKEN
 *   JIRA_PROJECT_KEY (default project)
 *   JIRA_ISSUE_TYPE  (default "Task")
 *   PROCUREMENT_DRY_RUN=true — skip HTTP, return fake issue
 */

function trimSlash(url) {
  return String(url ?? "").replace(/\/+$/, "");
}

export function getJiraConfig(overrides = {}) {
  const baseUrl = trimSlash(process.env.JIRA_BASE_URL ?? "");
  const email = String(process.env.JIRA_EMAIL ?? "").trim();
  const apiToken = String(process.env.JIRA_API_TOKEN ?? "").trim();
  const projectKey = String(
    overrides.projectKey || process.env.JIRA_PROJECT_KEY || "",
  ).trim();
  const issueType = String(
    overrides.issueType || process.env.JIRA_ISSUE_TYPE || "Task",
  ).trim() || "Task";
  const envDryRun =
    String(process.env.PROCUREMENT_DRY_RUN ?? "").toLowerCase() === "true";
  // Explicit override (including false) wins — see slack-client getSlackConfig.
  const dryRun =
    overrides.dryRun !== undefined && overrides.dryRun !== null
      ? Boolean(overrides.dryRun)
      : envDryRun;

  return { baseUrl, email, apiToken, projectKey, issueType, dryRun, envDryRun };
}

export function jiraConfigStatus(overrides = {}) {
  const cfg = getJiraConfig(overrides);
  const missing = [];
  if (!cfg.dryRun) {
    if (!cfg.baseUrl) missing.push("JIRA_BASE_URL");
    if (!cfg.email) missing.push("JIRA_EMAIL");
    if (!cfg.apiToken) missing.push("JIRA_API_TOKEN");
    if (!cfg.projectKey) missing.push("JIRA_PROJECT_KEY");
  } else if (!cfg.projectKey) {
    // dry-run still wants a project key for realistic payloads
    missing.push("JIRA_PROJECT_KEY");
  }
  return {
    configured: missing.length === 0,
    missing,
    dryRun: cfg.dryRun,
    baseUrl: cfg.baseUrl ? cfg.baseUrl : null,
    projectKey: cfg.projectKey || null,
    issueType: cfg.issueType,
  };
}

/**
 * @param {{ summary: string, description: string, projectKey?: string, issueType?: string, dryRun?: boolean }} input
 * @returns {Promise<{ key: string, id: string, self: string, url: string, dryRun: boolean }>}
 */
export async function createJiraIssue(input) {
  const cfg = getJiraConfig({
    projectKey: input.projectKey,
    issueType: input.issueType,
    dryRun: input.dryRun,
  });

  if (!cfg.projectKey) {
    throw new Error("Jira project key is not configured");
  }

  if (cfg.dryRun) {
    const key = `${cfg.projectKey}-DRY${Date.now().toString(36).toUpperCase()}`;
    const url = cfg.baseUrl
      ? `${cfg.baseUrl}/browse/${key}`
      : `https://example.atlassian.net/browse/${key}`;
    return {
      key,
      id: "dry-run",
      self: url,
      url,
      dryRun: true,
    };
  }

  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    throw new Error(
      "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.",
    );
  }

  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const endpoint = `${cfg.baseUrl}/rest/api/3/issue`;

  // ADF description keeps Cloud API happy; plain text also accepted via doc node.
  const body = {
    fields: {
      project: { key: cfg.projectKey },
      summary: String(input.summary ?? "").slice(0, 255),
      issuetype: { name: cfg.issueType },
      description: {
        type: "doc",
        version: 1,
        content: String(input.description ?? "")
          .split(/\n/)
          .map((line) =>
            line.trim() === ""
              ? { type: "paragraph", content: [] }
              : {
                  type: "paragraph",
                  content: [{ type: "text", text: line }],
                },
          ),
      },
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
      data?.errors && JSON.stringify(data.errors) ||
      text ||
      res.statusText;
    throw new Error(`Jira create issue failed (${res.status}): ${detail}`);
  }

  const key = String(data?.key ?? "");
  const id = String(data?.id ?? "");
  const self = String(data?.self ?? "");
  const url = key ? `${cfg.baseUrl}/browse/${key}` : self;

  return { key, id, self, url, dryRun: false };
}
