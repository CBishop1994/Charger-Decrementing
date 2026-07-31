import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { sendDbError } from "./_lib/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const [{ data: items, error: itemsErr }, { data: bins, error: binsErr }, { data: txs, error: txsErr }] =
      await Promise.all([
        supabaseAdmin.from("consumables").select("id,name,sku,quantity,min_level,is_active"),
        supabaseAdmin.from("bin_locations").select("id").eq("is_active", true),
        supabaseAdmin
          .from("stock_transactions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(12),
      ]);

    if (itemsErr) return sendDbError(res, itemsErr);
    if (binsErr) return sendDbError(res, binsErr);
    if (txsErr) return sendDbError(res, txsErr);

    const list = items ?? [];
    const low = list.filter((i) => i.quantity > 0 && i.quantity <= i.min_level);
    const out = list.filter((i) => i.quantity <= 0);

    // Attach consumable names to recent txs
    const ids = Array.from(
      new Set((txs ?? []).map((t) => t.consumable_id).filter(Boolean)),
    );
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

    const recent = (txs ?? []).map((t) => ({
      ...t,
      consumable_name: nameMap[t.consumable_id]?.name,
      consumable_sku: nameMap[t.consumable_id]?.sku,
    }));

    return res.status(200).json({
      total_items: list.length,
      low_stock_count: low.length,
      out_of_stock_count: out.length,
      total_bins: (bins ?? []).length,
      recent_transactions: recent,
      low_stock_items: low.slice(0, 8),
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
