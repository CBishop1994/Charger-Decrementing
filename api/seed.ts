import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { sendDbError } from "./_lib/errors.js";

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
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

    // Seed a couple of sample transactions
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
  } catch (err) {
    return sendDbError(res, err);
  }
}
