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
 * Convert the report's lightweight Markdown headings/bold spans to Jira ADF.
 * @param {unknown} value
 */
export function jiraDescriptionToAdf(value) {
  const inlineContent = (line) => {
    const content = [];
    const bold = /\*\*([^*]+)\*\*/g;
    const appendText = (text, marks = []) => {
      const urlPattern = /https?:\/\/[^\s<>"']+/gi;
      let cursor = 0;
      let urlMatch;

      while ((urlMatch = urlPattern.exec(text))) {
        const rawUrl = urlMatch[0];
        const href = rawUrl.replace(/[.,!?;:]+$/, "");
        if (!href) continue;
        if (urlMatch.index > cursor) {
          content.push({ type: "text", text: text.slice(cursor, urlMatch.index), ...(marks.length ? { marks } : {}) });
        }
        content.push({
          type: "text",
          text: href,
          marks: [...marks, { type: "link", attrs: { href } }],
        });
        const punctuation = rawUrl.slice(href.length);
        if (punctuation) {
          content.push({ type: "text", text: punctuation, ...(marks.length ? { marks } : {}) });
        }
        cursor = urlMatch.index + rawUrl.length;
      }

      if (cursor < text.length) {
        content.push({ type: "text", text: text.slice(cursor), ...(marks.length ? { marks } : {}) });
      }
    };
    let cursor = 0;
    let match;

    while ((match = bold.exec(line))) {
      if (match.index > cursor) {
        appendText(line.slice(cursor, match.index));
      }
      appendText(match[1], [{ type: "strong" }]);
      cursor = match.index + match[0].length;
    }

    if (cursor < line.length) {
      appendText(line.slice(cursor));
    }
    return content;
  };

  const content = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return { type: "paragraph", content: [] };
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        return {
          type: "heading",
          attrs: { level: heading[1].length },
          content: inlineContent(heading[2]),
        };
      }
      return { type: "paragraph", content: inlineContent(line) };
    });

  return { type: "doc", version: 1, content };
}

const DEFAULT_JIRA_REQUIRED_FIELDS = Object.freeze({
  "Service & Issues": "Catalog / Stock Issue",
  GEO: "US",
  Customer: "Firstbase",
});

/**
 * Resolve named Jira create fields to their internal field IDs and option IDs.
 * This avoids hard-coding customfield_NNNNN values, which differ by Jira site.
 * @param {object} cfg
 * @param {Record<string, string>} fields display name -> desired option/text
 */
async function resolveNamedCreateFields(cfg, fields) {
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };
  const root = `${cfg.baseUrl}/rest/api/3/issue/createmeta/${encodeURIComponent(cfg.projectKey)}/issuetypes`;
  const getJson = async (url, label) => {
    const res = await fetch(url, { method: "GET", headers });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!res.ok) {
      throw new Error(`Jira ${label} lookup failed (${res.status}): ${data?.errorMessages?.join?.("; ") || text || res.statusText}`);
    }
    return data;
  };

  const typeData = await getJson(`${root}?maxResults=100`, "issue type metadata");
  const issueTypes = Array.isArray(typeData.issueTypes)
    ? typeData.issueTypes
    : Array.isArray(typeData.values)
      ? typeData.values
      : [];
  const issueType = issueTypes.find((item) => String(item.name).toLowerCase() === cfg.issueType.toLowerCase());
  if (!issueType?.id) {
    throw new Error(`Jira issue type metadata did not include \"${cfg.issueType}\" for project ${cfg.projectKey}`);
  }

  const fieldsData = await getJson(`${root}/${encodeURIComponent(issueType.id)}?maxResults=100`, "create field metadata");
  const metadataFields = Array.isArray(fieldsData.fields)
    ? fieldsData.fields
    : Array.isArray(fieldsData.values)
      ? fieldsData.values
      : fieldsData.fields && typeof fieldsData.fields === "object"
        ? Object.entries(fieldsData.fields).map(([fieldId, field]) => ({ fieldId, ...field }))
        : [];
  const fieldMap = Object.fromEntries(
    metadataFields
      .filter((field) => field && (field.fieldId || field.id || field.key))
      .map((field) => [field.fieldId || field.id || field.key, field]),
  );
  const resolved = {};

  for (const [displayName, desired] of Object.entries(fields)) {
    const entry = Object.entries(fieldMap).find(([, field]) => String(field.name || "").trim().toLowerCase() === displayName.toLowerCase());
    if (!entry) throw new Error(`Required Jira field \"${displayName}\" was not found in create metadata for ${cfg.projectKey} / ${cfg.issueType}`);
    const [fieldId, field] = entry;
    const options = Array.isArray(field.allowedValues) ? field.allowedValues : [];
    if (options.length) {
      const option = options.find((item) => [item.value, item.name, item.label].some((value) => String(value ?? "").trim().toLowerCase() === desired.trim().toLowerCase()));
      if (!option?.id) {
        const choices = options.map((item) => item.value || item.name || item.label).filter(Boolean).join(", ");
        throw new Error(`Jira field \"${displayName}\" has no option \"${desired}\". Available options: ${choices || "(none returned)"}`);
      }
      resolved[fieldId] = field.schema?.type === "array" ? [{ id: String(option.id) }] : { id: String(option.id) };
    } else if (field.schema?.type === "string" || !field.schema?.type) {
      resolved[fieldId] = desired;
    } else {
      throw new Error(`Jira field \"${displayName}\" has no option metadata to resolve \"${desired}\"`);
    }
  }
  return resolved;
}

/**
 * @param {{ summary: string, description: string, projectKey?: string, issueType?: string, dryRun?: boolean, requiredFields?: Record<string, string> }} input
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
  const requiredFieldValues = {
    ...DEFAULT_JIRA_REQUIRED_FIELDS,
    ...(input.requiredFields ?? {}),
  };
  const requiredFields = await resolveNamedCreateFields(cfg, requiredFieldValues);
  const body = {
    fields: {
      ...requiredFields,
      project: { key: cfg.projectKey },
      summary: String(input.summary ?? "").slice(0, 255),
      issuetype: { name: cfg.issueType },
      description: jiraDescriptionToAdf(input.description),
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
