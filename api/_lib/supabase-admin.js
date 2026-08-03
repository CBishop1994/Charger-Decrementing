// Lazy service-role client so missing env vars fail at first use with a
// clear error instead of crashing the whole serverless module at import time.
// Do NOT import this from anywhere under src/ -- only from /api handlers.

import { createClient } from "@supabase/supabase-js";

let _client = null;

function createAdminClient() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [
      !supabaseUrl ? "SUPABASE_URL" : null,
      !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    ].filter(Boolean);
    throw new Error(
      `Missing ${missing.join(" and ")} in the serverless runtime environment. ` +
        `In Vercel: Project → Settings → Environment Variables — add exact names ` +
        `(no VITE_ prefix), enable Production + Preview, then Redeploy. ` +
        `Check /api/health for a safe present/missing report.`,
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Proxy so existing `supabaseAdmin.from(...)` call sites keep working while
 * construction is deferred until the first property access.
 */
export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop, receiver) {
      if (!_client) _client = createAdminClient();
      const value = Reflect.get(_client, prop, receiver);
      return typeof value === "function" ? value.bind(_client) : value;
    },
  },
);
