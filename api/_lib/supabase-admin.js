// @appbuilder-supabase-admin-v1 -- auto-injected by deploy pipeline.
// Do not edit by hand; the pipeline replaces this file on the next deploy.

import { createClient } from "@supabase/supabase-js";

// Service-role client. Do NOT import this from anywhere under src/ -- it
// must only be reached from Vercel serverless functions under /api.
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

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
