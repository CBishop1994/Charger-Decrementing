// Lazy service-role client so missing env vars fail at first use with a
// clear error instead of crashing the whole serverless module at import time.
// Do NOT import this from anywhere under src/ -- only from /api handlers.
//
// Local destage (`npm start` / NODE_ENV=development): when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are unset, use an in-memory store so demo seed
// and inventory APIs work offline. Production / any runtime with creds set
// always uses the real Supabase project.

import { createClient } from "@supabase/supabase-js";
import { isDevAuthEnabled } from "./dev-auth.js";
import { createLocalMemoryClient } from "./local-memory-db.js";

let _client = null;
/** @type {"supabase" | "local-memory" | null} */
let _mode = null;

export function hasSupabaseCredentials() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return Boolean(supabaseUrl && serviceRoleKey);
}

/** Active data backend after first client construction (null until first use). */
export function getDataBackendMode() {
  return _mode;
}

/**
 * Prefer reporting local-memory when destage can use it without constructing
 * the client yet (health checks).
 */
export function resolveDataBackendMode() {
  if (_mode) return _mode;
  if (hasSupabaseCredentials()) return "supabase";
  if (isDevAuthEnabled()) return "local-memory";
  return null;
}

function createAdminClient() {
  if (hasSupabaseCredentials()) {
    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    _mode = "supabase";
    return createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  if (isDevAuthEnabled()) {
    _mode = "local-memory";
    return createLocalMemoryClient();
  }

  const missing = [
    !(process.env.SUPABASE_URL || "").trim() ? "SUPABASE_URL" : null,
    !(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
      ? "SUPABASE_SERVICE_ROLE_KEY"
      : null,
  ].filter(Boolean);
  throw new Error(
    `Missing ${missing.join(" and ")} in the serverless runtime environment. ` +
      `In Vercel: Project → Settings → Environment Variables — add exact names ` +
      `(no VITE_ prefix), enable Production + Preview, then Redeploy. ` +
      `Check /api/health for a safe present/missing report.`,
  );
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
