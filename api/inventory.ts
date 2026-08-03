/**
 * Single Hobby-plan serverless function for all inventory APIs.
 * Public URLs (/api/consumables, /api/print, …) are rewritten here via vercel.json.
 * Query params injected by rewrites: resource, id?, action?
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import net from "node:net";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { isMissingTableError, sendDbError } from "./_lib/errors.js";
import {
  normalizeEmail,
  requireApprovedUser,
} from "./_lib/require-auth.js";
import {
  buildBinLocationLabelZpl,
  buildConsumableLabelZpl,
} from "./_lib/zpl.js";

type Auth = {
  email: string;
  name: string | null;
  picture: string | null;
  provider: string;
  sub: string;
  isAdmin: boolean;
  approved: Record<string, unknown>;
};

function qStr(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? "");
  return v == null ? "" : String(v);
}

function generateAssetTag(sku: string): string {
  const clean = sku.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "ITEM";
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  return `AST-${clean}-${stamp}`;
}

function generateBinAssetTag(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "BIN";
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  return `BIN-${clean}-${stamp}`;
}

/* ------------------------------------------------------------------ */
/* health (public)                                                     */
/* ------------------------------------------------------------------ */

function handleHealth(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  const googleId = process.env.GOOGLE_CLIENT_ID ?? "";
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

  const hasUrl = Boolean(url.trim());
  const hasServiceRoleKey = Boolean(serviceKey.trim());
  const hasAnonKey = Boolean(anonKey.trim());
  const hasSessionSecret = sessionSecret.trim().length >= 16;
  const hasGoogleId = Boolean(googleId.trim());
  const hasGoogleSecret = Boolean(googleSecret.trim());

  const ok =
    hasUrl &&
    hasServiceRoleKey &&
    hasSessionSecret &&
    hasGoogleId &&
    hasGoogleSecret;

  const missing: string[] = [];
  if (!hasUrl) missing.push("SUPABASE_URL");
  if (!hasServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!hasSessionSecret) missing.push("SESSION_SECRET");
  if (!hasGoogleId) missing.push("GOOGLE_CLIENT_ID");
  if (!hasGoogleSecret) missing.push("GOOGLE_CLIENT_SECRET");

  return res.status(ok ? 200 : 503).json({
    ok,
    runtime: "vercel-serverless",
    env: {
      SUPABASE_URL: {
        present: hasUrl,
        length: url.trim().length,
        looksLikeUrl: /^https:\/\/.+\.supabase\.co\/?$/i.test(url.trim()),
      },
      SUPABASE_SERVICE_ROLE_KEY: {
        present: hasServiceRoleKey,
        length: serviceKey.trim().length,
        looksLikeJwt: serviceKey.trim().startsWith("eyJ"),
      },
      SUPABASE_ANON_KEY: {
        present: hasAnonKey,
        length: anonKey.trim().length,
      },
      SESSION_SECRET: {
        present: Boolean(sessionSecret.trim()),
        length: sessionSecret.trim().length,
        longEnough: hasSessionSecret,
      },
      GOOGLE_CLIENT_ID: {
        present: hasGoogleId,
        length: googleId.trim().length,
      },
      GOOGLE_CLIENT_SECRET: {
        present: hasGoogleSecret,
        length: googleSecret.trim().length,
      },
    },
    missing,
    hint: ok
      ? "Required env vars look present. If sign-in still fails, check Google redirect URI and approved_emails table."
      : `Missing or invalid env vars: ${missing.join(", ")}. Add them under Vercel → Settings → Environment Variables (Production + Preview), then Redeploy.`,
    requiredNames: [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SESSION_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ],
  });
}

/* ------------------------------------------------------------------ */
/* consumables                                                         */
/* ------------------------------------------------------------------ */

async function handleConsumables(
  req: VercelRequest,
  res: VercelResponse,
  auth: Auth,
  id: number | null,
  action: string,
) {
  if (action === "adjust") {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!id) return res.status(400).json({ error: "Valid id is required" });

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
      .update({ quantity: next, updated_at: new Date().toISOString() })
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
  }

  if (id != null) {
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
      const { error } = await supabaseAdmin.from("consumables").delete().eq("id", id);
      if (error) return sendDbError(res, error);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // collection
  if (req.method === "GET") {
    const status = qStr(req.query.status) || "all";
    const search = qStr(req.query.search).trim();
    const category = qStr(req.query.category).trim();

    let query = supabaseAdmin
      .from("consumables")
      .select("*")
      .order("name", { ascending: true });

    if (category) query = query.eq("category", category);
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
}

/* ------------------------------------------------------------------ */
/* bin locations                                                       */
/* ------------------------------------------------------------------ */

async function handleBins(
  req: VercelRequest,
  res: VercelResponse,
  _auth: Auth,
  id: number | null,
) {
  if (id != null) {
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
  }

  if (req.method === "GET") {
    const search = qStr(req.query.search).trim();
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
}

/* ------------------------------------------------------------------ */
/* printers                                                            */
/* ------------------------------------------------------------------ */

async function handlePrinters(
  req: VercelRequest,
  res: VercelResponse,
  _auth: Auth,
  id: number | null,
) {
  if (id != null) {
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
        updates.label_width_mm = Number(body.label_width_mm) || 101.6;
      if (body.label_height_mm !== undefined)
        updates.label_height_mm = Number(body.label_height_mm) || 50.8;
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
  }

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
      label_width_mm: Number(body.label_width_mm ?? 101.6) || 101.6,
      label_height_mm: Number(body.label_height_mm ?? 50.8) || 50.8,
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
}

/* ------------------------------------------------------------------ */
/* transactions / dashboard / seed                                     */
/* ------------------------------------------------------------------ */

async function handleTransactions(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const consumableIdRaw = qStr(req.query.consumable_id);
  const consumableId = consumableIdRaw ? Number(consumableIdRaw) : null;
  const limit = Math.min(100, Math.max(1, Number(qStr(req.query.limit) || 50) || 50));

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
  const nameMap: Record<number, { name: string; sku: string }> = {};
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
}

async function handleDashboard(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const [
    { data: items, error: itemsErr },
    { data: bins, error: binsErr },
    { data: txs, error: txsErr },
  ] = await Promise.all([
    supabaseAdmin
      .from("consumables")
      .select("id,name,sku,quantity,min_level,is_active"),
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

  const ids = Array.from(
    new Set((txs ?? []).map((t) => t.consumable_id).filter(Boolean)),
  );
  const nameMap: Record<number, { name: string; sku: string }> = {};
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
}

const SAMPLE_BINS = [
  {
    code: "A-01-01",
    name: "Fasteners — Upper",
    zone: "A",
    aisle: "01",
    shelf: "01",
    description: "Bolts, nuts, washers",
    asset_tag: "BIN-A0101-DEMO1",
  },
  {
    code: "A-01-02",
    name: "Fasteners — Lower",
    zone: "A",
    aisle: "01",
    shelf: "02",
    description: "Screws and anchors",
    asset_tag: "BIN-A0102-DEMO2",
  },
  {
    code: "B-02-01",
    name: "PPE Rack",
    zone: "B",
    aisle: "02",
    shelf: "01",
    description: "Gloves, glasses, ear protection",
    asset_tag: "BIN-B0201-DEMO3",
  },
  {
    code: "C-03-01",
    name: "Lubricants",
    zone: "C",
    aisle: "03",
    shelf: "01",
    description: "Oils and greases",
    asset_tag: "BIN-C0301-DEMO4",
  },
];

const SAMPLE_ITEMS = [
  {
    name: "M8 Hex Bolts",
    sku: "BOLT-M8-25",
    description: "M8 x 25mm zinc hex bolts",
    quantity: 120,
    min_level: 40,
    unit: "ea",
    category: "Fasteners",
    bin_location: "A-01-01",
    asset_tag: "AST-BOLTM8-DEMO1",
    notes: "Supplier pack of 100",
  },
  {
    name: "M8 Nylon Lock Nuts",
    sku: "NUT-M8-NYL",
    description: "M8 nyloc nuts",
    quantity: 18,
    min_level: 50,
    unit: "ea",
    category: "Fasteners",
    bin_location: "A-01-01",
    asset_tag: "AST-NUTM8-DEMO2",
    notes: "Low stock — reorder soon",
  },
  {
    name: "Nitrile Gloves (L)",
    sku: "PPE-GLV-L",
    description: "Powder-free nitrile, large",
    quantity: 6,
    min_level: 12,
    unit: "box",
    category: "PPE",
    bin_location: "B-02-01",
    asset_tag: "AST-GLVL-DEMO3",
    notes: "",
  },
  {
    name: "Safety Glasses",
    sku: "PPE-GLS-CLR",
    description: "Clear polycarbonate safety glasses",
    quantity: 0,
    min_level: 10,
    unit: "ea",
    category: "PPE",
    bin_location: "B-02-01",
    asset_tag: "AST-GLSCLR-DEMO4",
    notes: "Out of stock",
  },
  {
    name: "Machine Oil ISO 68",
    sku: "LUB-ISO68-1L",
    description: "1L bottle hydraulic / machine oil",
    quantity: 14,
    min_level: 4,
    unit: "btl",
    category: "Lubricants",
    bin_location: "C-03-01",
    asset_tag: "AST-ISO68-DEMO5",
    notes: "",
  },
  {
    name: "Cable Ties 200mm",
    sku: "TIE-200-BLK",
    description: "Black nylon cable ties 200mm",
    quantity: 3,
    min_level: 5,
    unit: "pk",
    category: "Electrical",
    bin_location: "A-01-02",
    asset_tag: "AST-TIE200-DEMO6",
    notes: "",
  },
];

async function handleSeed(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const force = Boolean(req.body?.force);

  const { count: itemCount, error: countErr } = await supabaseAdmin
    .from("consumables")
    .select("id", { count: "exact", head: true });
  if (countErr) return sendDbError(res, countErr);

  if ((itemCount ?? 0) > 0 && !force) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      message: "Database already has consumables. Pass force=true to re-seed.",
    });
  }

  if (force) {
    await supabaseAdmin.from("stock_transactions").delete().neq("id", 0);
    await supabaseAdmin.from("consumables").delete().neq("id", 0);
    await supabaseAdmin.from("bin_locations").delete().neq("id", 0);
    await supabaseAdmin.from("printer_settings").delete().neq("id", 0);
  }

  const { data: bins, error: binsErr } = await supabaseAdmin
    .from("bin_locations")
    .insert(SAMPLE_BINS.map((b) => ({ ...b, is_active: true })))
    .select();
  if (binsErr) return sendDbError(res, binsErr);

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("consumables")
    .insert(
      SAMPLE_ITEMS.map((i) => ({
        ...i,
        is_active: true,
        updated_at: new Date().toISOString(),
      })),
    )
    .select();
  if (itemsErr) return sendDbError(res, itemsErr);

  const { data: printers, error: printErr } = await supabaseAdmin
    .from("printer_settings")
    .insert({
      name: "Retrievals Printer",
      host: "192.168.96.21",
      port: 9100,
      protocol: "zpl",
      label_width_mm: 101.6,
      label_height_mm: 50.8,
      dpi: 203,
      is_default: true,
      notes:
        "Default shop-floor Zebra on 192.168.96.21:9100 (4×2 in labels @ 203 dpi). Host app must reach this LAN IP for live Print; otherwise use Download ZPL.",
    })
    .select();
  if (printErr) return sendDbError(res, printErr);

  if (items && items.length >= 2) {
    await supabaseAdmin.from("stock_transactions").insert([
      {
        consumable_id: items[0].id,
        change_amount: -5,
        previous_quantity: 125,
        new_quantity: 120,
        reason: "use",
        note: "Production line A",
        created_by: "demo",
      },
      {
        consumable_id: items[1].id,
        change_amount: -10,
        previous_quantity: 28,
        new_quantity: 18,
        reason: "use",
        note: "Maintenance kit build",
        created_by: "demo",
      },
    ]);
  }

  return res.status(201).json({
    ok: true,
    bins: bins?.length ?? 0,
    consumables: items?.length ?? 0,
    printers: printers?.length ?? 0,
  });
}

/* ------------------------------------------------------------------ */
/* print                                                               */
/* ------------------------------------------------------------------ */

type PrinterRow = {
  id: number;
  name: string;
  host: string;
  port: number;
  protocol: string;
  label_width_mm: number;
  label_height_mm: number;
  dpi: number;
  is_default: boolean;
};

async function resolvePrinter(printerId?: number | null): Promise<PrinterRow | null> {
  if (printerId) {
    const { data } = await supabaseAdmin
      .from("printer_settings")
      .select("*")
      .eq("id", printerId)
      .single();
    if (data) return data as PrinterRow;
  }
  const { data: def } = await supabaseAdmin
    .from("printer_settings")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();
  if (def) return def as PrinterRow;

  const { data: first } = await supabaseAdmin
    .from("printer_settings")
    .select("*")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (first as PrinterRow) ?? null;
}

function sendRawToPrinter(
  host: string,
  port: number,
  payload: string,
  timeoutMs = 8000,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () =>
      finish({ ok: false, error: "Printer connection timed out" }),
    );
    socket.once("error", (err) =>
      finish({ ok: false, error: err.message || "Printer connection failed" }),
    );
    socket.connect(port, host, () => {
      socket.write(payload, "utf8", (err) => {
        if (err) {
          finish({
            ok: false,
            error: err.message || "Failed to write to printer",
          });
          return;
        }
        socket.end(() => finish({ ok: true }));
      });
    });
  });
}

async function handlePrint(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body ?? {};
  const type = String(body.type ?? "").trim();
  const id = Number(body.id);
  const copies = Math.min(20, Math.max(1, Number(body.copies ?? 1) || 1));
  const dryRun = Boolean(body.dry_run);
  const printerId = body.printer_id != null ? Number(body.printer_id) : null;

  if (!type || (type !== "consumable" && type !== "bin")) {
    return res
      .status(400)
      .json({ error: "type must be 'consumable' or 'bin'" });
  }
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: "Valid id is required" });
  }

  const printer = await resolvePrinter(printerId);
  if (!printer && !dryRun) {
    return res.status(400).json({
      error:
        "No printer configured. Add a network printer under Printers, or use Download ZPL.",
    });
  }

  const size = {
    widthMm:
      printer?.label_width_mm ?? (Number(body.label_width_mm ?? 101.6) || 101.6),
    heightMm:
      printer?.label_height_mm ??
      (Number(body.label_height_mm ?? 50.8) || 50.8),
    dpi: printer?.dpi ?? (Number(body.dpi ?? 203) || 203),
  };

  let zpl = "";
  let labelMeta: Record<string, unknown> = {};

  if (type === "consumable") {
    const { data: item, error } = await supabaseAdmin
      .from("consumables")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !item) {
      if (error && isMissingTableError(error.message)) return sendDbError(res, error);
      return res.status(404).json({ error: error?.message || "Item not found" });
    }
    let assetTag = String(item.asset_tag || "").trim();
    if (!assetTag) {
      assetTag = `AST-${String(item.sku)
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .slice(0, 8)}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
      await supabaseAdmin
        .from("consumables")
        .update({ asset_tag: assetTag, updated_at: new Date().toISOString() })
        .eq("id", id);
      item.asset_tag = assetTag;
    }
    zpl = buildConsumableLabelZpl(item, size);
    labelMeta = {
      kind: "consumable",
      name: item.name,
      sku: item.sku,
      asset_tag: item.asset_tag,
      bin_location: item.bin_location,
    };
  } else {
    const { data: bin, error } = await supabaseAdmin
      .from("bin_locations")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !bin) {
      if (error && isMissingTableError(error.message)) return sendDbError(res, error);
      return res.status(404).json({ error: error?.message || "Bin not found" });
    }
    let assetTag = String(bin.asset_tag || "").trim();
    if (!assetTag) {
      assetTag = `BIN-${String(bin.code)
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .slice(0, 8)}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
      await supabaseAdmin
        .from("bin_locations")
        .update({ asset_tag: assetTag, updated_at: new Date().toISOString() })
        .eq("id", id);
      bin.asset_tag = assetTag;
    }
    zpl = buildBinLocationLabelZpl(bin, size);
    labelMeta = {
      kind: "bin",
      code: bin.code,
      name: bin.name,
      asset_tag: bin.asset_tag,
      zone: bin.zone,
      aisle: bin.aisle,
      shelf: bin.shelf,
    };
  }

  const fullZpl = Array.from({ length: copies }, () => zpl).join("\n");

  if (dryRun || body.download_only) {
    return res.status(200).json({
      ok: true,
      dry_run: true,
      zpl: fullZpl,
      copies,
      printer: printer
        ? {
            id: printer.id,
            name: printer.name,
            host: printer.host,
            port: printer.port,
          }
        : null,
      label: labelMeta,
    });
  }

  const result = await sendRawToPrinter(printer!.host, printer!.port, fullZpl);
  if (!result.ok) {
    const unreachable =
      /EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|timed out|no route/i.test(
        result.error,
      );
    return res.status(502).json({
      error: result.error,
      code: unreachable ? "PRINTER_UNREACHABLE" : "PRINT_FAILED",
      hint: unreachable
        ? `This app server cannot reach ${printer!.host}:${printer!.port}. Vercel (cloud) cannot print to private LAN IPs like 192.168.x.x. Use Download ZPL and send it from a PC on the printer network, or host this app on-prem / VPN where ${printer!.host} is reachable. Also confirm RAW/9100 is enabled on the printer.`
        : "Check that the printer IP is reachable from this server and RAW/9100 is enabled. You can still Download ZPL and send it with a local print utility.",
      zpl: fullZpl,
      printer: {
        id: printer!.id,
        name: printer!.name,
        host: printer!.host,
        port: printer!.port,
      },
      label: labelMeta,
    });
  }

  return res.status(200).json({
    ok: true,
    printed: true,
    copies,
    printer: {
      id: printer!.id,
      name: printer!.name,
      host: printer!.host,
      port: printer!.port,
    },
    label: labelMeta,
    zpl: fullZpl,
  });
}

/* ------------------------------------------------------------------ */
/* approved emails                                                     */
/* ------------------------------------------------------------------ */

async function handleApprovedEmails(
  req: VercelRequest,
  res: VercelResponse,
  auth: Auth | null,
  id: number | null,
) {
  if (id != null) {
    if (req.method === "PATCH") {
      const a = auth;
      if (!a) return;
      if (!a.isAdmin) {
        return res
          .status(403)
          .json({ error: "Admin access required", code: "FORBIDDEN" });
      }

      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name ?? "").trim();
      if (body.notes !== undefined) patch.notes = String(body.notes ?? "").trim();
      if (body.is_admin !== undefined) patch.is_admin = Boolean(body.is_admin);

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

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
      const a = auth;
      if (!a) return;
      if (!a.isAdmin) {
        return res
          .status(403)
          .json({ error: "Admin access required", code: "FORBIDDEN" });
      }

      const { data: target, error: loadErr } = await supabaseAdmin
        .from("approved_emails")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (loadErr) return sendDbError(res, loadErr);
      if (!target) return res.status(404).json({ error: "Not found" });

      if (target.email === a.email) {
        return res
          .status(400)
          .json({ error: "You cannot remove your own access" });
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
  }

  if (req.method === "GET") {
    if (!auth) return;
    const { data, error } = await supabaseAdmin
      .from("approved_emails")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) return sendDbError(res, error);
    return res.status(200).json(data ?? []);
  }

  if (req.method === "POST") {
    if (!auth) return;
    if (!auth.isAdmin) {
      return res
        .status(403)
        .json({ error: "Admin access required", code: "FORBIDDEN" });
    }

    const body = req.body ?? {};
    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    const name = String(body.name ?? "").trim();
    const notes = String(body.notes ?? "").trim();
    const is_admin = Boolean(body.is_admin);

    const { data: existing } = await supabaseAdmin
      .from("approved_emails")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: "That email is already approved" });
    }

    const { data, error } = await supabaseAdmin
      .from("approved_emails")
      .insert({
        email,
        name,
        notes,
        is_admin,
        created_by: auth.email,
      })
      .select()
      .single();
    if (error) return sendDbError(res, error);
    return res.status(201).json(data);
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}

/* ------------------------------------------------------------------ */
/* main router                                                         */
/* ------------------------------------------------------------------ */

/**
 * Prefer rewrite-injected query (`resource` / `id` / `action`).
 * Fall back to parsing the request path so local Vite (file-based)
 * and any non-rewrite callers still work if pointed at /api/inventory/...
 */
function resolveRoute(req: VercelRequest): {
  resource: string;
  id: number | null;
  action: string;
} {
  let resource = qStr(req.query.resource).trim();
  let idRaw = qStr(req.query.id).trim();
  let action = qStr(req.query.action).trim();

  if (!resource) {
    const url = req.url ?? "";
    const pathOnly = url.split("?")[0] ?? "";
    // /api/inventory/consumables/12/adjust or /api/consumables/...
    const cleaned = pathOnly
      .replace(/^\/api\/inventory\/?/, "")
      .replace(/^\/api\//, "");
    const parts = cleaned.split("/").filter(Boolean);
    resource = parts[0] ?? "";
    if (parts[1] && /^\d+$/.test(parts[1])) {
      idRaw = parts[1];
      action = parts[2] ?? action;
    } else if (parts[1]) {
      action = parts[1];
    }
  }

  const idNum = idRaw ? Number(idRaw) : NaN;
  const id = Number.isFinite(idNum) && idNum > 0 ? idNum : null;

  return { resource, id, action };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { resource, id, action } = resolveRoute(req);

    // bare /api/inventory or explicit health — public diagnostics
    if (!resource || resource === "health") {
      return handleHealth(req, res);
    }

    // Everything else requires an approved session
    const auth = await requireApprovedUser(req, res, {
      requireAdmin: false,
    });
    if (!auth) return;

    if (resource === "consumables") {
      return await handleConsumables(req, res, auth as Auth, id, action);
    }
    if (resource === "bin-locations") {
      return await handleBins(req, res, auth as Auth, id);
    }
    if (resource === "printers") {
      return await handlePrinters(req, res, auth as Auth, id);
    }
    if (resource === "transactions") {
      return await handleTransactions(req, res);
    }
    if (resource === "dashboard") {
      return await handleDashboard(req, res);
    }
    if (resource === "seed") {
      return await handleSeed(req, res);
    }
    if (resource === "print") {
      return await handlePrint(req, res);
    }
    if (resource === "approved-emails") {
      return await handleApprovedEmails(req, res, auth as Auth, id);
    }

    return res.status(404).json({
      error: `Unknown resource: ${resource}`,
      code: "NOT_FOUND",
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
