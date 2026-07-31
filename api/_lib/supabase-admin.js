// @appbuilder-supabase-admin-v1 -- auto-injected by deploy pipeline.
// Do not edit by hand; the pipeline replaces this file on the next deploy.

import { createClient } from "@supabase/supabase-js";

// Service-role client. Do NOT import this from anywhere under src/ -- it
// must only be reached from Vercel serverless functions under /api.
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the serverless runtime environment.",
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
