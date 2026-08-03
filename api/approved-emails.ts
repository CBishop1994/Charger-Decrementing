import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { sendDbError } from "./_lib/errors.js";
import {
  normalizeEmail,
  requireApprovedUser,
} from "./_lib/require-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const auth = await requireApprovedUser(req, res);
      if (!auth) return;

      const { data, error } = await supabaseAdmin
        .from("approved_emails")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) return sendDbError(res, error);
      return res.status(200).json(data ?? []);
    }

    if (req.method === "POST") {
      const auth = await requireApprovedUser(req, res, { requireAdmin: true });
      if (!auth) return;

      const body = req.body ?? {};
      const email = normalizeEmail(body.email);
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "A valid email is required" });
      }

      const name = String(body.name ?? "").trim();
      const notes = String(body.notes ?? "").trim();
      const is_admin = Boolean(body.is_admin);

      const { data: existing } = await supabaseAdmin
        .from("approved_emails")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existing) {
        return res.status(409).json({ error: "That email is already approved" });
      }

      const { data, error } = await supabaseAdmin
        .from("approved_emails")
        .insert({
          email,
          name,
          notes,
          is_admin,
          created_by: auth.email,
        })
        .select()
        .single();

      if (error) return sendDbError(res, error);
      return res.status(201).json(data);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sendDbError(res, err);
  }
}
