/**
 * Session + approved-email gate for inventory API routes.
 * Uses the OAuth session cookie and the approved_emails table in Supabase.
 */

import { loadSession } from "../auth/_lib/session.js";
import { supabaseAdmin } from "./supabase-admin.js";

/**
 * Normalize emails for allowlist comparison.
 * @param {string | null | undefined} email
 */
export function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Look up an approved email row (case-insensitive via stored lowercase).
 * @param {string} email
 */
export async function getApprovedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const { data, error } = await supabaseAdmin
    .from("approved_emails")
    .select("*")
    .eq("email", normalized)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

/**
 * Count approved emails (for first-user bootstrap).
 */
export async function countApprovedEmails() {
  const { count, error } = await supabaseAdmin
    .from("approved_emails")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/**
 * Ensure the Google user is on the allowlist.
 * If the allowlist is empty, the first successful signer becomes admin.
 *
 * @param {{ email?: string | null, name?: string | null }} profile
 * @returns {Promise<{ ok: true, row: object } | { ok: false, code: string, message: string }>}
 */
export async function ensureApprovedForSignIn(profile) {
  const email = normalizeEmail(profile?.email);
  if (!email) {
    return {
      ok: false,
      code: "missing_email",
      message:
        "Google did not return an email address. Use a Google account with a verified email.",
    };
  }

  const existing = await getApprovedEmail(email);
  if (existing) {
    return { ok: true, row: existing };
  }

  const total = await countApprovedEmails();
  if (total === 0) {
    const { data, error } = await supabaseAdmin
      .from("approved_emails")
      .insert({
        email,
        name: String(profile?.name ?? "").trim(),
        is_admin: true,
        created_by: "bootstrap",
        notes: "First sign-in — auto-approved as admin",
      })
      .select()
      .single();

    if (error) throw error;
    return { ok: true, row: data };
  }

  return {
    ok: false,
    code: "not_approved",
    message:
      "This Google account is not on the approved access list. Ask a StockTag admin to add your email.",
  };
}

/**
 * Require a signed-in user whose email is still on the allowlist.
 * Returns the session + approved row, or sends 401/403 and returns null.
 *
 * @param {import("node:http").IncomingMessage | import("@vercel/node").VercelRequest} req
 * @param {import("node:http").ServerResponse | import("@vercel/node").VercelResponse} res
 * @param {{ requireAdmin?: boolean }} [opts]
 */
export async function requireApprovedUser(req, res, opts = {}) {
  try {
    const session = await loadSession(req);
    if (!session?.email) {
      res.status(401).json({
        error: "Sign in required",
        code: "UNAUTHENTICATED",
      });
      return null;
    }

    const row = await getApprovedEmail(session.email);
    if (!row) {
      res.status(403).json({
        error:
          "Your account is no longer on the approved access list. Contact an admin.",
        code: "NOT_APPROVED",
      });
      return null;
    }

    if (opts.requireAdmin && !row.is_admin) {
      res.status(403).json({
        error: "Admin access required",
        code: "FORBIDDEN",
      });
      return null;
    }

    return {
      session,
      approved: row,
      email: normalizeEmail(session.email),
      name: session.name ?? row.name ?? "",
      isAdmin: Boolean(row.is_admin),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Authentication check failed";
    // Missing table → guide setup without leaking internals
    if (
      /schema cache|could not find the table|does not exist/i.test(message)
    ) {
      res.status(503).json({
        error:
          "Access control table is not set up yet. Create the approved_emails table, then reload.",
        code: "SETUP_REQUIRED",
        detail: message,
      });
      return null;
    }
    res.status(500).json({ error: message });
    return null;
  }
}
