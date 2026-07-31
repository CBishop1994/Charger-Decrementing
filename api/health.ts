import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Safe diagnostics for production env wiring.
 * Never returns secret values — only booleans / lengths.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

  const hasUrl = Boolean(url.trim());
  const hasServiceRoleKey = Boolean(serviceKey.trim());
  const hasAnonKey = Boolean(anonKey.trim());

  const ok = hasUrl && hasServiceRoleKey;

  return res.status(ok ? 200 : 503).json({
    ok,
    runtime: "vercel-serverless",
    env: {
      SUPABASE_URL: {
        present: hasUrl,
        length: url.trim().length,
        looksLikeUrl: /^https:\/\/.+\.supabase\.co\/?$/i.test(url.trim()),
      },
      SUPABASE_SERVICE_ROLE_KEY: {
        present: hasServiceRoleKey,
        length: serviceKey.trim().length,
        looksLikeJwt: serviceKey.trim().startsWith("eyJ"),
      },
      SUPABASE_ANON_KEY: {
        present: hasAnonKey,
        length: anonKey.trim().length,
      },
    },
    hint: ok
      ? "Supabase env vars look present. If API routes still fail, check table setup (Push to Supabase) and redeploy."
      : "One or more required env vars are missing in this Vercel deployment. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY under Project → Settings → Environment Variables for Production (and Preview), then Redeploy.",
    requiredNames: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  });
}
