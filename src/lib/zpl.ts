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
  return String(value ?? "")
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
 * Normalize label size so we never accidentally emit a tiny 2×1 layout
 * on 4×2 stock (that looks "squished" into the top-left corner).
 */
export function normalizeLabelSize(size?: Partial<LabelSize> | null): LabelSize {
  const dpi = Number(size?.dpi) > 0 ? Number(size?.dpi) : 203;
  let widthMm = Number(size?.widthMm);
  let heightMm = Number(size?.heightMm);

  // Missing / invalid → 4×2 in
  if (!Number.isFinite(widthMm) || widthMm <= 0) widthMm = 101.6;
  if (!Number.isFinite(heightMm) || heightMm <= 0) heightMm = 50.8;

  // Values that look like inches by mistake (e.g. 4 and 2) → convert
  if (widthMm <= 12 && heightMm <= 12) {
    widthMm *= 25.4;
    heightMm *= 25.4;
  }

  // Anything still smaller than ~3×1.5 in is almost certainly the old
  // 50×25 default — bump to full 4×2 so labels fill the stock.
  if (widthMm < 76 || heightMm < 38) {
    widthMm = 101.6;
    heightMm = 50.8;
  }

  return { widthMm, heightMm, dpi };
}

/** QR magnification that fills ~half the label height. */
function qrMagnification(heightDots: number, dpi: number): number {
  // Target QR side ≈ 55% of label height for a strong scan target on 4×2
  const target = Math.floor(heightDots * 0.55);
  // Module count for short alphanumeric payloads is roughly 25–33
  const mag = Math.round(target / 29);
  return Math.min(10, Math.max(4, mag || (dpi >= 300 ? 5 : 4)));
}

/** Default shop-floor label: 4×2 in (101.6 × 50.8 mm) @ 203 dpi — ZT411 common. */
export const DEFAULT_LABEL_SIZE: LabelSize = {
  widthMm: 101.6,
  heightMm: 50.8,
  dpi: 203,
};

/**
 * Build a full-bleed asset-tag ZPL label with a large QR code.
 * Coordinates are computed from the label size so content fills 4×2 stock
 * instead of sitting in the top-left corner.
 */
export function buildAssetTagZpl(
  payload: AssetTagPayload,
  size: LabelSize = DEFAULT_LABEL_SIZE,
): string {
  const { widthMm, heightMm, dpi = 203 } = normalizeLabelSize(size);
  const width = mmToDots(widthMm, dpi);
  const height = mmToDots(heightMm, dpi);

  const qrData = escapeZpl(
    payload.qrValue || payload.barcodeValue || payload.assetTag,
  );
  const tag = escapeZpl(payload.assetTag);
  const title = escapeZpl(payload.title);
  const subtitle = escapeZpl(payload.subtitle || "");
  const footer = escapeZpl(payload.footer || "");

  // Margins ~3 mm from edges
  const margin = Math.max(16, Math.round(mmToDots(3, dpi)));
  const gap = Math.max(12, Math.round(mmToDots(2, dpi)));

  // QR on the right — large enough to scan easily on 4×2
  const mag = qrMagnification(height, dpi);
  // Approximate rendered QR side (modules ≈ 29 for short payloads + quiet zone)
  const qrSide = mag * 29;
  const qrX = width - margin - qrSide;
  const qrY = Math.round((height - qrSide) / 2);

  // Text column uses everything left of the QR with a gap
  const textX = margin;
  const textW = Math.max(120, qrX - gap - textX);

  // Type scale from label height (4×2 @ 203dpi → height 406)
  // Tuned so a 4×2 label uses large, readable fonts across the full height.
  const titleH = Math.max(28, Math.round(height * 0.11));
  const subH = Math.max(20, Math.round(height * 0.07));
  const tagH = Math.max(32, Math.round(height * 0.13));
  const fieldH = Math.max(18, Math.round(height * 0.06));
  const footerH = Math.max(16, Math.round(height * 0.05));
  const lineGap = Math.max(8, Math.round(height * 0.025));

  const lines: string[] = [
    "^XA",
    "^CI28",
    // Explicit print width / length in dots — critical so ZT411 doesn't
    // keep an old smaller format and park graphics in the corner.
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    "^LT0",
    "^LS0",
    "^PR4,4",
    "^MD20",
    // Clear image buffer before drawing
    "^MCY",
  ];

  // Vertical stack starting near the top, ending above the footer
  let y = margin;

  // Title (wrap up to 2 lines)
  lines.push(
    `^FO${textX},${y}^A0N,${titleH},${titleH}^FB${textW},${2},0,L,0^FD${title}^FS`,
  );
  y += titleH * 2 + lineGap;

  if (subtitle) {
    lines.push(
      `^FO${textX},${y}^A0N,${subH},${subH}^FB${textW},1,0,L,0^FD${subtitle}^FS`,
    );
    y += subH + lineGap;
  }

  // Asset tag — most prominent text
  lines.push(
    `^FO${textX},${y}^A0N,${tagH},${tagH}^FB${textW},1,0,L,0^FD${tag}^FS`,
  );
  y += tagH + lineGap + 4;

  // Optional fields (BIN / MIN / LOC)
  for (const field of payload.fields ?? []) {
    if (y + fieldH > height - margin - footerH - lineGap) break;
    const line = `${escapeZpl(field.label)}: ${escapeZpl(field.value)}`;
    lines.push(
      `^FO${textX},${y}^A0N,${fieldH},${fieldH}^FB${textW},1,0,L,0^FD${line}^FS`,
    );
    y += fieldH + lineGap;
  }

  // Large QR on the right, vertically centered
  // QA = automatic mode (most compatible on ZT411)
  lines.push(`^FO${qrX},${qrY}^BQN,2,${mag}^FDQA,${qrData}^FS`);

  // Footer along the bottom of the text column
  if (footer) {
    const footerY = height - margin - footerH;
    lines.push(
      `^FO${textX},${footerY}^A0N,${footerH},${footerH}^FB${textW},1,0,L,0^FD${footer}^FS`,
    );
  }

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
    size ?? DEFAULT_LABEL_SIZE,
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
    size ?? DEFAULT_LABEL_SIZE,
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
