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

/** Build a compact asset-tag ZPL label with a QR code. */
export function buildAssetTagZpl(
  payload: AssetTagPayload,
  size: LabelSize = { widthMm: 50, heightMm: 25, dpi: 203 },
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

  const mag = qrMagnification(height, dpi);
  const qrSide = mag * 29;
  const qrX = Math.max(16, width - qrSide - 16);
  const qrY = Math.max(12, Math.round((height - qrSide) / 2));
  const textMaxX = qrX - 12;

  const lines: string[] = [
    "^XA",
    "^CI28",
    "^PR4,4",
    "^MD15",
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    `^FO16,12^A0N,26,26^FB${textMaxX - 16},2,0,L,0^FD${title}^FS`,
  ];

  let y = 44;
  if (subtitle) {
    lines.push(
      `^FO16,${y}^A0N,18,18^FB${textMaxX - 16},1,0,L,0^FD${subtitle}^FS`,
    );
    y += 24;
  }

  lines.push(
    `^FO16,${y}^A0N,28,28^FB${textMaxX - 16},1,0,L,0^FD${tag}^FS`,
  );
  y += 34;

  for (const field of payload.fields ?? []) {
    if (y > height - 28) break;
    lines.push(
      `^FO16,${y}^A0N,16,16^FB${textMaxX - 16},1,0,L,0^FD${escapeZpl(field.label)}: ${escapeZpl(field.value)}^FS`,
    );
    y += 20;
  }

  lines.push(`^FO${qrX},${qrY}^BQN,2,${mag}^FDMA,${qrData}^FS`);

  if (footer) {
    lines.push(
      `^FO16,${height - 20}^A0N,14,14^FB${textMaxX - 16},1,0,L,0^FD${footer}^FS`,
    );
  }

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
