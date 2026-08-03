import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { sendDbError } from "./_lib/errors.js";
import { requireApprovedUser } from "./_lib/require-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await requireApprovedUser(req, res);
    if (!auth) return;

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("printer_settings")
        .select("*")
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });
      if (error) return sendDbError(res, error);
      return res.status(200).json(data ?? []);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const name = String(body.name ?? "").trim();
      const host = String(body.host ?? "").trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      if (!host) return res.status(400).json({ error: "Host / IP is required" });

      const is_default = Boolean(body.is_default);
      if (is_default) {
        await supabaseAdmin
          .from("printer_settings")
          .update({ is_default: false })
          .eq("is_default", true);
      }

      const payload = {
        name,
        host,
        port: Math.max(1, Number(body.port ?? 9100) || 9100),
        protocol: String(body.protocol ?? "zpl").trim() || "zpl",
        label_width_mm: Number(body.label_width_mm ?? 50) || 50,
        label_height_mm: Number(body.label_height_mm ?? 25) || 25,
        dpi: Math.max(100, Number(body.dpi ?? 203) || 203),
        is_default,
        notes: String(body.notes ?? "").trim(),
      };

      const { data, error } = await supabaseAdmin
        .from("printer_settings")
        .insert(payload)
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
