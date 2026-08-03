import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { sendDbError } from "./_lib/errors.js";
import { requireApprovedUser } from "./_lib/require-auth.js";

function generateAssetTag(sku: string): string {
  const clean = sku.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "ITEM";
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  return `AST-${clean}-${stamp}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await requireApprovedUser(req, res);
    if (!auth) return;

    if (req.method === "GET") {
      const status = String(req.query.status ?? "all");
      const search = String(req.query.search ?? "").trim();
      const category = String(req.query.category ?? "").trim();

      let query = supabaseAdmin
        .from("consumables")
        .select("*")
        .order("name", { ascending: true });

      if (status !== "all") {
        // filter client-side after fetch for low/out — quantity vs min_level
      }
      if (category) {
        query = query.eq("category", category);
      }
      if (search) {
        query = query.or(
          `name.ilike.%${search}%,sku.ilike.%${search}%,asset_tag.ilike.%${search}%,bin_location.ilike.%${search}%`,
        );
      }

      const { data, error } = await query;
      if (error) return sendDbError(res, error);

      let rows = data ?? [];
      if (status === "low") {
        rows = rows.filter((r) => r.quantity > 0 && r.quantity <= r.min_level);
      } else if (status === "out") {
        rows = rows.filter((r) => r.quantity <= 0);
      } else if (status === "ok") {
        rows = rows.filter((r) => r.quantity > r.min_level);
      } else if (status === "active") {
        rows = rows.filter((r) => r.is_active);
      }

      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const name = String(body.name ?? "").trim();
      const sku = String(body.sku ?? "").trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      if (!sku) return res.status(400).json({ error: "SKU is required" });

      const quantity = Math.max(0, Number(body.quantity ?? 0) || 0);
      const min_level = Math.max(0, Number(body.min_level ?? 0) || 0);
      const asset_tag =
        String(body.asset_tag ?? "").trim() || generateAssetTag(sku);

      const payload = {
        name,
        sku,
        description: String(body.description ?? "").trim(),
        quantity,
        min_level,
        unit: String(body.unit ?? "ea").trim() || "ea",
        category: String(body.category ?? "General").trim() || "General",
        bin_location: String(body.bin_location ?? "").trim(),
        asset_tag,
        notes: String(body.notes ?? "").trim(),
        is_active: body.is_active !== false,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from("consumables")
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
