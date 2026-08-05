/**
 * Client for Zebra Browser Print (local desktop helper).
 *
 * Browser Print runs on the user's PC and exposes:
 *   http://127.0.0.1:9100   (HTTP)
 *   https://127.0.0.1:9101  (HTTPS — preferred when the app is on HTTPS)
 *
 * Cloud servers cannot reach LAN printers; this talks to the local PC only.
 */

export type ZebraBrowserPrinter = {
  name: string;
  uid: string;
  connection: string;
  deviceType?: string;
  version?: string;
  provider?: string;
  manufacturer?: string;
};

export class BrowserPrintError extends Error {
  code: "OFFLINE" | "NO_PRINTERS" | "WRITE_FAILED" | "TIMEOUT" | "UNKNOWN";

  constructor(
    message: string,
    code: BrowserPrintError["code"] = "UNKNOWN",
  ) {
    super(message);
    this.name = "BrowserPrintError";
    this.code = code;
  }
}

const ENDPOINTS = [
  // HTTPS first — required when StockTag is served over https:// (Vercel)
  "https://127.0.0.1:9101",
  "https://localhost:9101",
  // HTTP fallback (works for local http://dev and some setups)
  "http://127.0.0.1:9100",
  "http://localhost:9100",
] as const;

const LS_KEY = "stocktag.browserPrint.uid";

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  ms = 4000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

let cachedBase: string | null = null;

/** Probe Browser Print endpoints and cache the first that responds. */
export async function resolveBrowserPrintBase(
  force = false,
): Promise<string | null> {
  if (!force && cachedBase) return cachedBase;

  for (const base of ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(`${base}/available`, {}, 2500);
      if (res.ok) {
        cachedBase = base;
        return base;
      }
    } catch {
      /* try next */
    }
  }
  cachedBase = null;
  return null;
}

export async function isBrowserPrintOnline(): Promise<boolean> {
  const base = await resolveBrowserPrintBase(true);
  return Boolean(base);
}

/**
 * Ask Browser Print for connected Zebra printers.
 * Throws BrowserPrintError if the helper is not running.
 */
export async function discoverZebraPrinters(): Promise<ZebraBrowserPrinter[]> {
  const base = await resolveBrowserPrintBase(true);
  if (!base) {
    throw new BrowserPrintError(
      "Zebra Browser Print is not running on this computer. Install it from Zebra and keep it open in the background.",
      "OFFLINE",
    );
  }

  try {
    const res = await fetchWithTimeout(`${base}/available`, {}, 4000);
    if (!res.ok) {
      throw new BrowserPrintError(
        `Browser Print returned HTTP ${res.status}`,
        "UNKNOWN",
      );
    }
    const data = (await res.json()) as {
      printer?: ZebraBrowserPrinter | ZebraBrowserPrinter[];
      device?: ZebraBrowserPrinter | ZebraBrowserPrinter[];
    };

    const raw = data.printer ?? data.device ?? [];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.filter((p) => p && (p.uid || p.name));
  } catch (err) {
    if (err instanceof BrowserPrintError) throw err;
    throw new BrowserPrintError(
      "Could not reach Zebra Browser Print. Is it installed and running?",
      "OFFLINE",
    );
  }
}

/** Remember the last-used printer uid in localStorage. */
export function getSavedPrinterUid(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function savePrinterUid(uid: string) {
  try {
    localStorage.setItem(LS_KEY, uid);
  } catch {
    /* ignore */
  }
}

/** Pick default printer: saved uid → first USB → first in list. */
export function pickDefaultPrinter(
  printers: ZebraBrowserPrinter[],
): ZebraBrowserPrinter | null {
  if (!printers.length) return null;
  const saved = getSavedPrinterUid();
  if (saved) {
    const match = printers.find((p) => p.uid === saved);
    if (match) return match;
  }
  const usb = printers.find((p) =>
    /usb/i.test(`${p.connection ?? ""} ${p.provider ?? ""}`),
  );
  return usb ?? printers[0];
}

/**
 * Send a ZPL string to a Browser Print device.
 * For batches, pass ZPL that already contains N copies (repeated ^XA…^XZ blocks
 * or a single format with ^PQn).
 */
export async function sendZplToBrowserPrint(
  printer: ZebraBrowserPrinter,
  zpl: string,
): Promise<void> {
  const base = await resolveBrowserPrintBase();
  if (!base) {
    throw new BrowserPrintError(
      "Zebra Browser Print went offline. Restart Browser Print and try again.",
      "OFFLINE",
    );
  }

  const body = JSON.stringify({
    device: {
      name: printer.name,
      uid: printer.uid,
      connection: printer.connection,
      deviceType: printer.deviceType ?? "printer",
      version: printer.version ?? 0,
      provider: printer.provider,
      manufacturer: printer.manufacturer ?? "Zebra Technologies",
    },
    data: zpl,
  });

  try {
    const res = await fetchWithTimeout(
      `${base}/write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      15000,
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BrowserPrintError(
        text || `Print failed (HTTP ${res.status})`,
        "WRITE_FAILED",
      );
    }

    savePrinterUid(printer.uid);
  } catch (err) {
    if (err instanceof BrowserPrintError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new BrowserPrintError(
        "Print timed out. Check that the printer is on and selected in Browser Print.",
        "TIMEOUT",
      );
    }
    throw new BrowserPrintError(
      err instanceof Error ? err.message : "Failed to send label to printer",
      "WRITE_FAILED",
    );
  }
}

/**
 * Build a multi-copy ZPL payload from a single-label format.
 * Prefer ^PQ when the format already has one ^XA…^XZ; otherwise repeat blocks.
 */
export function withCopies(singleLabelZpl: string, copies: number): string {
  const n = Math.max(1, Math.min(99, Math.trunc(copies) || 1));
  const cleaned = singleLabelZpl
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (n === 1) {
    return `${cleaned.replace(/\n/g, "\r\n")}\r\n`;
  }

  // If there's a single format, inject/replace ^PQn for efficient batching
  const xaCount = (cleaned.match(/\^XA/gi) ?? []).length;
  if (xaCount <= 1) {
    let body = cleaned;
    if (/\^PQ[\d,]+/i.test(body)) {
      body = body.replace(/\^PQ[\d,]+/i, `^PQ${n},0,1,Y`);
    } else {
      body = body.replace(/\^XZ/i, `^PQ${n},0,1,Y\n^XZ`);
    }
    return `${body.replace(/\n/g, "\r\n")}\r\n`;
  }

  // Multiple blocks already — repeat the whole payload
  const one = cleaned.replace(/\n/g, "\r\n").replace(/\r\n$/, "");
  return `${Array.from({ length: n }, () => one).join("\r\n")}\r\n`;
}
