import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { isMissingTableError, sendDbError } from "../../_lib/errors.js";
import { requireApprovedUser } from "../../_lib/require-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await requireApprovedUser(req, res);
    if (!auth) return;

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const id = Number(req.query.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "Valid id is required" });
    }

    const body = req.body ?? {};
    const delta = Number(body.delta);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ error: "Non-zero numeric delta is required" });
    }

    const reason = String(body.reason ?? (delta < 0 ? "use" : "restock")).trim();
    const note = String(body.note ?? "").trim();
    const created_by =
      auth.email ||
      String(body.created_by ?? "operator").trim() ||
      "operator";

    const { data: item, error: fetchErr } = await supabaseAdmin
      .from("consumables")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !item) {
      if (fetchErr && isMissingTableError(fetchErr.message)) {
        return sendDbError(res, fetchErr);
      }
      return res.status(404).json({ error: fetchErr?.message || "Item not found" });
    }

    const previous = Number(item.quantity) || 0;
    const next = Math.max(0, previous + Math.trunc(delta));

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("consumables")
      .update({
        quantity: next,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) return sendDbError(res, updateErr);

    const { data: tx, error: txErr } = await supabaseAdmin
      .from("stock_transactions")
      .insert({
        consumable_id: id,
        change_amount: next - previous,
        previous_quantity: previous,
        new_quantity: next,
        reason,
        note,
        created_by,
      })
      .select()
      .single();

    if (txErr) return sendDbError(res, txErr);

    return res.status(200).json({
      consumable: updated,
      transaction: tx,
      low_stock: next > 0 && next <= Number(updated.min_level),
      out_of_stock: next <= 0,
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
