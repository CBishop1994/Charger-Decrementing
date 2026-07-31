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
        .from("printer_settings")
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
      const updates: Record<string, unknown> = {};

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return res.status(400).json({ error: "Name cannot be empty" });
        updates.name = name;
      }
      if (body.host !== undefined) {
        const host = String(body.host).trim();
        if (!host) return res.status(400).json({ error: "Host cannot be empty" });
        updates.host = host;
      }
      if (body.port !== undefined)
        updates.port = Math.max(1, Number(body.port) || 9100);
      if (body.protocol !== undefined)
        updates.protocol = String(body.protocol).trim() || "zpl";
      if (body.label_width_mm !== undefined)
        updates.label_width_mm = Number(body.label_width_mm) || 50;
      if (body.label_height_mm !== undefined)
        updates.label_height_mm = Number(body.label_height_mm) || 25;
      if (body.dpi !== undefined)
        updates.dpi = Math.max(100, Number(body.dpi) || 203);
      if (body.notes !== undefined) updates.notes = String(body.notes).trim();

      if (body.is_default === true) {
        await supabaseAdmin
          .from("printer_settings")
          .update({ is_default: false })
          .neq("id", id);
        updates.is_default = true;
      } else if (body.is_default === false) {
        updates.is_default = false;
      }

      const { data, error } = await supabaseAdmin
        .from("printer_settings")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) return sendDbError(res, error);
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin
        .from("printer_settings")
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
