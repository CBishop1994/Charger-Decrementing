/**
 * Vercel Cron entrypoint — weekly consumables inventory alerts at Monday 8:00am MST.
 *
 * Schedule (vercel.json): "0 15 * * 1"  →  15:00 UTC Mondays = 8:00am MST (UTC−7).
 *
 * Auth: Authorization: Bearer <CRON_SECRET>  (or ?secret= for manual curl).
 * Also accepts an approved admin session cookie for local testing.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runConsumablesWeeklyAlerts } from "../_lib/consumables-alerts.js";
import { requireApprovedUser } from "../_lib/require-auth.js";
import { isDevAuthEnabled } from "../_lib/dev-auth.js";

function bearerToken(req: VercelRequest): string {
  const h = req.headers.authorization ?? req.headers.Authorization;
  const raw = Array.isArray(h) ? h[0] : h;
  if (!raw) return "";
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? "";
}

function querySecret(req: VercelRequest): string {
  const s = req.query?.secret;
  if (Array.isArray(s)) return String(s[0] ?? "");
  return String(s ?? "");
}

function cronAuthorized(req: VercelRequest): boolean {
  const expected = String(process.env.CRON_SECRET ?? "").trim();
  if (!expected) {
    // Local destage only: allow without secret when dev auth is on.
    return isDevAuthEnabled();
  }
  const token = bearerToken(req) || querySecret(req);
  return Boolean(token) && token === expected;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let triggeredBy = "cron";

  if (cronAuthorized(req)) {
    triggeredBy = "cron";
  } else {
    const auth = await requireApprovedUser(req, res, { requireAdmin: true });
    if (!auth) return;
    triggeredBy = `admin:${auth.email}`;
  }

  try {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const result = await runConsumablesWeeklyAlerts({
      weekKey: body.week_key ? String(body.week_key) : undefined,
      dryRun: body.dry_run != null ? Boolean(body.dry_run) : undefined,
      force: body.force != null ? Boolean(body.force) : undefined,
      triggeredBy,
    });
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message, code: "ALERTS_FAILED" });
  }
}
