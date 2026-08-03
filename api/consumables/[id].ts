import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { isMissingTableError, sendDbError } from "../_lib/errors.js";
import { requireApprovedUser } from "../_lib/require-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await requireApprovedUser(req, res);
    if (!auth) return;

    const id = Number(req.query.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "Valid id is required" });
    }

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("consumables")
        .select("*")
        .eq("id", id)
        .single();
      if (error) {
        if (isMissingTableError(error.message)) return sendDbError(res, error);
        return res.status(404).json({ error: error.message });
      }
      return res.status(200).json(data);
    }

    if (req.method === "PATCH") {
      const body = req.body ?? {};
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return res.status(400).json({ error: "Name cannot be empty" });
        updates.name = name;
      }
      if (body.sku !== undefined) {
        const sku = String(body.sku).trim();
        if (!sku) return res.status(400).json({ error: "SKU cannot be empty" });
        updates.sku = sku;
      }
      if (body.description !== undefined)
        updates.description = String(body.description).trim();
      if (body.quantity !== undefined)
        updates.quantity = Math.max(0, Number(body.quantity) || 0);
      if (body.min_level !== undefined)
        updates.min_level = Math.max(0, Number(body.min_level) || 0);
      if (body.unit !== undefined)
        updates.unit = String(body.unit).trim() || "ea";
      if (body.category !== undefined)
        updates.category = String(body.category).trim() || "General";
      if (body.bin_location !== undefined)
        updates.bin_location = String(body.bin_location).trim();
      if (body.asset_tag !== undefined)
        updates.asset_tag = String(body.asset_tag).trim();
      if (body.notes !== undefined) updates.notes = String(body.notes).trim();
      if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

      const { data, error } = await supabaseAdmin
        .from("consumables")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) return sendDbError(res, error);
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin
        .from("consumables")
        .delete()
        .eq("id", id);
      if (error) return sendDbError(res, error);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sendDbError(res, err);
  }
}
