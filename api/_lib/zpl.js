/** ZPL helpers for asset-tag / bin-location labels (Zebra-compatible). */

function mmToDots(mm, dpi = 203) {
  return Math.round((mm / 25.4) * dpi);
}

function escapeZpl(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, " ")
    .replace(/~/g, " ")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 64);
}

/** CRLF + trailing newline; strip BOM for Windows / Zebra utilities. */
export function finalizeZpl(zpl) {
  const normalized = String(zpl ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  return `${normalized.replace(/\n/g, "\r\n")}\r\n`;
}

/**
 * Normalize label size so we never emit a tiny 2×1 layout on 4×2 stock.
 */
export function normalizeLabelSize(size) {
  const dpi = Number(size?.dpi) > 0 ? Number(size.dpi) : 203;
  let widthMm = Number(size?.widthMm);
  let heightMm = Number(size?.heightMm);

  if (!Number.isFinite(widthMm) || widthMm <= 0) widthMm = 101.6;
  if (!Number.isFinite(heightMm) || heightMm <= 0) heightMm = 50.8;

  if (widthMm <= 12 && heightMm <= 12) {
    widthMm *= 25.4;
    heightMm *= 25.4;
  }

  if (widthMm < 76 || heightMm < 38) {
    widthMm = 101.6;
    heightMm = 50.8;
  }

  return { widthMm, heightMm, dpi };
}

function qrMagnification(heightDots, dpi) {
  const target = Math.floor(heightDots * 0.55);
  const mag = Math.round(target / 29);
  return Math.min(10, Math.max(4, mag || (dpi >= 300 ? 5 : 4)));
}

/** Default shop-floor label: 4×2 in (101.6 × 50.8 mm) @ 203 dpi. */
export const DEFAULT_LABEL_SIZE = {
  widthMm: 101.6,
  heightMm: 50.8,
  dpi: 203,
};

/** Build a full-bleed asset-tag ZPL label with a large QR code. */
export function buildAssetTagZpl(payload, size = DEFAULT_LABEL_SIZE) {
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

  const margin = Math.max(16, Math.round(mmToDots(3, dpi)));
  const gap = Math.max(12, Math.round(mmToDots(2, dpi)));

  const mag = qrMagnification(height, dpi);
  const qrSide = mag * 29;
  const qrX = width - margin - qrSide;
  const qrY = Math.round((height - qrSide) / 2);

  const textX = margin;
  const textW = Math.max(120, qrX - gap - textX);

  const titleH = Math.max(28, Math.round(height * 0.11));
  const subH = Math.max(20, Math.round(height * 0.07));
  const tagH = Math.max(32, Math.round(height * 0.13));
  const fieldH = Math.max(18, Math.round(height * 0.06));
  const footerH = Math.max(16, Math.round(height * 0.05));
  const lineGap = Math.max(8, Math.round(height * 0.025));

  const lines = [
    "^XA",
    "^CI28",
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    "^LT0",
    "^LS0",
    "^PR4,4",
    "^MD20",
    "^MCY",
  ];

  let y = margin;

  lines.push(
    `^FO${textX},${y}^A0N,${titleH},${titleH}^FB${textW},2,0,L,0^FD${title}^FS`,
  );
  y += titleH * 2 + lineGap;

  if (subtitle) {
    lines.push(
      `^FO${textX},${y}^A0N,${subH},${subH}^FB${textW},1,0,L,0^FD${subtitle}^FS`,
    );
    y += subH + lineGap;
  }

  lines.push(
    `^FO${textX},${y}^A0N,${tagH},${tagH}^FB${textW},1,0,L,0^FD${tag}^FS`,
  );
  y += tagH + lineGap + 4;

  for (const field of payload.fields ?? []) {
    if (y + fieldH > height - margin - footerH - lineGap) break;
    const line = `${escapeZpl(field.label)}: ${escapeZpl(field.value)}`;
    lines.push(
      `^FO${textX},${y}^A0N,${fieldH},${fieldH}^FB${textW},1,0,L,0^FD${line}^FS`,
    );
    y += fieldH + lineGap;
  }

  lines.push(`^FO${qrX},${qrY}^BQN,2,${mag}^FDQA,${qrData}^FS`);

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

export function buildConsumableLabelZpl(item, size) {
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
    size || DEFAULT_LABEL_SIZE,
  );
}

export function buildBinLocationLabelZpl(bin, size) {
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
    size || DEFAULT_LABEL_SIZE,
  );
}
