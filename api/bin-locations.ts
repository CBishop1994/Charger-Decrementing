import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { sendDbError } from "./_lib/errors.js";

function generateBinAssetTag(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "BIN";
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  return `BIN-${clean}-${stamp}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const search = String(req.query.search ?? "").trim();
      let query = supabaseAdmin
        .from("bin_locations")
        .select("*")
        .order("code", { ascending: true });

      if (search) {
        query = query.or(
          `code.ilike.%${search}%,name.ilike.%${search}%,zone.ilike.%${search}%,asset_tag.ilike.%${search}%`,
        );
      }

      const { data, error } = await query;
      if (error) return sendDbError(res, error);
      return res.status(200).json(data ?? []);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const code = String(body.code ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      if (!code) return res.status(400).json({ error: "Code is required" });
      if (!name) return res.status(400).json({ error: "Name is required" });

      const asset_tag =
        String(body.asset_tag ?? "").trim() || generateBinAssetTag(code);

      const payload = {
        code,
        name,
        zone: String(body.zone ?? "").trim(),
        aisle: String(body.aisle ?? "").trim(),
        shelf: String(body.shelf ?? "").trim(),
        description: String(body.description ?? "").trim(),
        asset_tag,
        is_active: body.is_active !== false,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from("bin_locations")
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
