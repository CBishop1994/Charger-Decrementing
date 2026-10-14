/**
 * Admin HTTP handler for Slack/Jira integration probes.
 *
 * GET  /api/integrations/status — config health (no outbound write)
 * POST /api/integrations/test   — auth or write probe
 *   body: { targets?: "slack"|"jira"|"both", mode?: "auth"|"write", dry_run?: boolean }
 */

import {
  buildIntegrationsStatus,
  resolveIntegrationDryRun,
} from "./integration-dry-run.js";
import { runIntegrationTests } from "./integration-test.js";

/**
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 * @param {{ isAdmin?: boolean }} auth
 * @param {string|null} action
 */
export async function handleIntegrations(req, res, auth, action) {
  if (!auth?.isAdmin) {
    return res.status(403).json({
      error: "Admin access required",
      code: "FORBIDDEN",
    });
  }

  const act = String(action || "").toLowerCase() || "status";

  if (act === "status" && req.method === "GET") {
    const resolved = resolveIntegrationDryRun({});
    return res.status(200).json({
      integrations: buildIntegrationsStatus(resolved, {}),
      hints: {
        auth:
          "POST /api/integrations/test with { \"mode\": \"auth\" } to verify tokens",
        write:
          "POST /api/integrations/test with { \"mode\": \"write\", \"dry_run\": false } to post Slack + create a [TEST] Jira issue",
        note: "Jira uses email + API token (not OAuth app scopes). Slack needs xoxb- bot token.",
      },
    });
  }

  if (act === "test" && req.method === "POST") {
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};
    const dryRun =
      body.dry_run != null ? Boolean(body.dry_run) : undefined;
    const result = await runIntegrationTests({
      targets: body.targets ?? "both",
      mode: body.mode === "write" ? "write" : "auth",
      dryRun,
    });
    // Always 200 so the Admin UI can render per-service failures (ok:false).
    return res.status(200).json(result);
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({
    error: "Use GET ?action=status or POST ?action=test",
    code: "METHOD_NOT_ALLOWED",
  });
}
