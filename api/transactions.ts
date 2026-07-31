import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { sendDbError } from "./_lib/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const consumableId = req.query.consumable_id
      ? Number(req.query.consumable_id)
      : null;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));

    let query = supabaseAdmin
      .from("stock_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (consumableId && !Number.isNaN(consumableId)) {
      query = query.eq("consumable_id", consumableId);
    }

    const { data, error } = await query;
    if (error) return sendDbError(res, error);

    const rows = data ?? [];
    const ids = Array.from(new Set(rows.map((r) => r.consumable_id)));
    let nameMap: Record<number, { name: string; sku: string }> = {};
    if (ids.length) {
      const { data: named } = await supabaseAdmin
        .from("consumables")
        .select("id,name,sku")
        .in("id", ids);
      for (const n of named ?? []) {
        nameMap[n.id] = { name: n.name, sku: n.sku };
      }
    }

    return res.status(200).json(
      rows.map((r) => ({
        ...r,
        consumable_name: nameMap[r.consumable_id]?.name,
        consumable_sku: nameMap[r.consumable_id]?.sku,
      })),
    );
  } catch (err) {
    return sendDbError(res, err);
  }
}
