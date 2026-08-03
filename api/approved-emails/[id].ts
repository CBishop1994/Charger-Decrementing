import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { sendDbError } from "../_lib/errors.js";
import { requireApprovedUser } from "../_lib/require-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const id = Number(req.query.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    if (req.method === "PATCH") {
      const auth = await requireApprovedUser(req, res, { requireAdmin: true });
      if (!auth) return;

      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name ?? "").trim();
      if (body.notes !== undefined) patch.notes = String(body.notes ?? "").trim();
      if (body.is_admin !== undefined) patch.is_admin = Boolean(body.is_admin);

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      // Prevent demoting yourself if you are the last admin
      if (patch.is_admin === false) {
        const { data: target } = await supabaseAdmin
          .from("approved_emails")
          .select("id,email,is_admin")
          .eq("id", id)
          .maybeSingle();
        if (target?.is_admin) {
          const { count } = await supabaseAdmin
            .from("approved_emails")
            .select("id", { count: "exact", head: true })
            .eq("is_admin", true);
          if ((count ?? 0) <= 1) {
            return res.status(400).json({
              error: "Cannot remove admin from the last admin account",
            });
          }
        }
      }

      const { data, error } = await supabaseAdmin
        .from("approved_emails")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) return sendDbError(res, error);
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      const auth = await requireApprovedUser(req, res, { requireAdmin: true });
      if (!auth) return;

      const { data: target, error: loadErr } = await supabaseAdmin
        .from("approved_emails")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (loadErr) return sendDbError(res, loadErr);
      if (!target) return res.status(404).json({ error: "Not found" });

      if (target.email === auth.email) {
        return res.status(400).json({ error: "You cannot remove your own access" });
      }

      if (target.is_admin) {
        const { count } = await supabaseAdmin
          .from("approved_emails")
          .select("id", { count: "exact", head: true })
          .eq("is_admin", true);
        if ((count ?? 0) <= 1) {
          return res.status(400).json({
            error: "Cannot delete the last admin account",
          });
        }
      }

      const { error } = await supabaseAdmin
        .from("approved_emails")
        .delete()
        .eq("id", id);
      if (error) return sendDbError(res, error);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sendDbError(res, err);
  }
}
