import type { VercelRequest, VercelResponse } from "@vercel/node";
import net from "node:net";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { isMissingTableError, sendDbError } from "./_lib/errors.js";
import {
  buildBinLocationLabelZpl,
  buildConsumableLabelZpl,
} from "../src/lib/zpl.js";

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
    socket.once("timeout", () => finish({ ok: false, error: "Printer connection timed out" }));
    socket.once("error", (err) =>
      finish({ ok: false, error: err.message || "Printer connection failed" }),
    );
    socket.connect(port, host, () => {
      socket.write(payload, "utf8", (err) => {
        if (err) {
          finish({ ok: false, error: err.message || "Failed to write to printer" });
          return;
        }
        // Give the printer a beat, then close cleanly
        socket.end(() => finish({ ok: true }));
      });
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body ?? {};
    const type = String(body.type ?? "").trim(); // consumable | bin
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
        printer?.label_width_mm ??
        (Number(body.label_width_mm ?? 50) || 50),
      heightMm:
        printer?.label_height_mm ??
        (Number(body.label_height_mm ?? 25) || 25),
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
      // Ensure asset tag exists
      let assetTag = String(item.asset_tag || "").trim();
      if (!assetTag) {
        assetTag = `AST-${String(item.sku).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8)}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
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
        assetTag = `BIN-${String(bin.code).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8)}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
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
          ? { id: printer.id, name: printer.name, host: printer.host, port: printer.port }
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
  } catch (err) {
    return sendDbError(res, err);
  }
}
