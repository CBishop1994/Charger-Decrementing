import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { isMissingTableError, sendDbError } from "../_lib/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const id = Number(req.query.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "Valid id is required" });
    }

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("bin_locations")
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

      if (body.code !== undefined) {
        const code = String(body.code).trim().toUpperCase();
        if (!code) return res.status(400).json({ error: "Code cannot be empty" });
        updates.code = code;
      }
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return res.status(400).json({ error: "Name cannot be empty" });
        updates.name = name;
      }
      if (body.zone !== undefined) updates.zone = String(body.zone).trim();
      if (body.aisle !== undefined) updates.aisle = String(body.aisle).trim();
      if (body.shelf !== undefined) updates.shelf = String(body.shelf).trim();
      if (body.description !== undefined)
        updates.description = String(body.description).trim();
      if (body.asset_tag !== undefined)
        updates.asset_tag = String(body.asset_tag).trim();
      if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

      const { data, error } = await supabaseAdmin
        .from("bin_locations")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) return sendDbError(res, error);
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin
        .from("bin_locations")
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
