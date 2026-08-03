/** ZPL helpers for asset-tag / bin-location labels (Zebra-compatible). */

export type LabelSize = {
  widthMm: number;
  heightMm: number;
  dpi?: number;
};

export type AssetTagPayload = {
  title: string;
  subtitle?: string;
  assetTag: string;
  /** Value encoded in the QR code (defaults to assetTag). */
  qrValue?: string;
  /** @deprecated Use qrValue — kept as an alias for older call sites. */
  barcodeValue?: string;
  fields?: Array<{ label: string; value: string }>;
  footer?: string;
};

function mmToDots(mm: number, dpi = 203): number {
  return Math.round((mm / 25.4) * dpi);
}

function escapeZpl(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, " ")
    .replace(/~/g, " ")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 64);
}

/**
 * Finalize ZPL for download / raw send.
 * - CRLF line endings (Windows + many Zebra utilities prefer this)
 * - Trailing newline so the printer sees a complete stream
 * - No UTF-8 BOM (BOMs make some tools reject the file)
 */
export function finalizeZpl(zpl: string): string {
  const normalized = String(zpl ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  return `${normalized.replace(/\n/g, "\r\n")}\r\n`;
}

/**
 * Magnification for ^BQ based on label height so the QR stays scannable
 * without overflowing a small asset tag.
 */
function qrMagnification(heightDots: number, dpi: number): number {
  const target = Math.floor(heightDots * 0.48);
  const mag = Math.round(target / 29);
  return Math.min(10, Math.max(3, mag || (dpi >= 300 ? 4 : 3)));
}

/** Default shop-floor label: 4×2 in (101.6 × 50.8 mm) @ 203 dpi — ZT411 common. */
export const DEFAULT_LABEL_SIZE: LabelSize = {
  widthMm: 101.6,
  heightMm: 50.8,
  dpi: 203,
};

/** Build a compact asset-tag ZPL label with a QR code. Tuned for 4×2" labels. */
export function buildAssetTagZpl(
  payload: AssetTagPayload,
  size: LabelSize = DEFAULT_LABEL_SIZE,
): string {
  const dpi = size.dpi ?? 203;
  const width = mmToDots(size.widthMm, dpi);
  const height = mmToDots(size.heightMm, dpi);
  const qrData = escapeZpl(
    payload.qrValue || payload.barcodeValue || payload.assetTag,
  );
  const tag = escapeZpl(payload.assetTag);
  const title = escapeZpl(payload.title);
  const subtitle = escapeZpl(payload.subtitle || "");
  const footer = escapeZpl(payload.footer || "");

  // Scale type from label height so 4×2" (≈406 dots @ 203dpi) stays readable
  // while smaller tags still fit.
  const scale = Math.max(0.75, Math.min(1.35, height / 400));
  const pad = Math.round(20 * scale);
  const titleH = Math.round(36 * scale);
  const subH = Math.round(24 * scale);
  const tagH = Math.round(42 * scale);
  const fieldH = Math.round(22 * scale);
  const footerH = Math.round(18 * scale);

  const mag = qrMagnification(height, dpi);
  const qrSide = mag * 29;
  const qrX = Math.max(pad, width - qrSide - pad);
  const qrY = Math.max(pad, Math.round((height - qrSide) / 2));
  const textMaxX = qrX - pad;
  const textW = Math.max(80, textMaxX - pad);

  const lines: string[] = [
    "^XA",
    // ZT411-friendly defaults
    "^CI28",
    "^PW" + width,
    "^LL" + height,
    "^LH0,0",
    "^LT0",
    "^LS0",
    // Do not override media type (^MN) — keep the ZT411's calibrated gap/mark setting
    "^PR4,4",
    "^MD15",
    // Start fresh format
    `^FO${pad},${pad}^A0N,${titleH},${titleH}^FB${textW},2,0,L,0^FD${title}^FS`,
  ];

  let y = pad + titleH + Math.round(10 * scale);
  if (subtitle) {
    lines.push(
      `^FO${pad},${y}^A0N,${subH},${subH}^FB${textW},1,0,L,0^FD${subtitle}^FS`,
    );
    y += subH + Math.round(8 * scale);
  }

  lines.push(
    `^FO${pad},${y}^A0N,${tagH},${tagH}^FB${textW},1,0,L,0^FD${tag}^FS`,
  );
  y += tagH + Math.round(12 * scale);

  for (const field of payload.fields ?? []) {
    if (y > height - footerH - pad * 2) break;
    lines.push(
      `^FO${pad},${y}^A0N,${fieldH},${fieldH}^FB${textW},1,0,L,0^FD${escapeZpl(field.label)}: ${escapeZpl(field.value)}^FS`,
    );
    y += fieldH + Math.round(6 * scale);
  }

  // QR — Field Data: QA = automatic mode (most compatible on ZT411)
  lines.push(`^FO${qrX},${qrY}^BQN,2,${mag}^FDQA,${qrData}^FS`);

  if (footer) {
    lines.push(
      `^FO${pad},${height - footerH - pad}^A0N,${footerH},${footerH}^FB${textW},1,0,L,0^FD${footer}^FS`,
    );
  }

  // Print quantity 1 for this format block (copies are duplicated by caller)
  lines.push("^PQ1,0,1,Y");
  lines.push("^XZ");
  return finalizeZpl(lines.join("\n"));
}

export function buildConsumableLabelZpl(
  item: {
    name: string;
    sku: string;
    asset_tag: string;
    bin_location?: string;
    min_level?: number;
    unit?: string;
  },
  size?: LabelSize,
): string {
  const code = item.asset_tag || item.sku;
  return buildAssetTagZpl(
    {
      title: item.name,
      subtitle: `SKU ${item.sku}`,
      assetTag: code,
      qrValue: code,
      fields: [
        ...(item.bin_location
          ? [{ label: "BIN", value: item.bin_location }]
          : []),
        ...(item.min_level != null
          ? [{ label: "MIN", value: `${item.min_level} ${item.unit || "ea"}` }]
          : []),
      ],
      footer: "CONSUMABLE",
    },
    size,
  );
}

export function buildBinLocationLabelZpl(
  bin: {
    code: string;
    name: string;
    zone?: string;
    aisle?: string;
    shelf?: string;
    asset_tag: string;
  },
  size?: LabelSize,
): string {
  const code = bin.asset_tag || bin.code;
  const locParts = [bin.zone, bin.aisle, bin.shelf].filter(Boolean).join(" / ");
  return buildAssetTagZpl(
    {
      title: bin.code,
      subtitle: bin.name,
      assetTag: code,
      qrValue: code,
      fields: locParts ? [{ label: "LOC", value: locParts }] : [],
      footer: "BIN LOCATION",
    },
    size,
  );
}

/** Human-readable preview lines for on-screen label mock. */
export function labelPreviewLines(payload: AssetTagPayload): string[] {
  const lines = [payload.title];
  if (payload.subtitle) lines.push(payload.subtitle);
  lines.push(payload.assetTag);
  for (const f of payload.fields ?? []) {
    lines.push(`${f.label}: ${f.value}`);
  }
  if (payload.footer) lines.push(payload.footer);
  return lines;
}
