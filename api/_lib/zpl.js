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

function qrMagnification(heightDots, dpi) {
  const target = Math.floor(heightDots * 0.48);
  const mag = Math.round(target / 29);
  return Math.min(10, Math.max(3, mag || (dpi >= 300 ? 4 : 3)));
}

/** Default shop-floor label: 4×2 in (101.6 × 50.8 mm) @ 203 dpi. */
export const DEFAULT_LABEL_SIZE = {
  widthMm: 101.6,
  heightMm: 50.8,
  dpi: 203,
};

/** Build a compact asset-tag ZPL label with a QR code. Tuned for 4×2". */
export function buildAssetTagZpl(payload, size = DEFAULT_LABEL_SIZE) {
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

  const lines = [
    "^XA",
    "^CI28",
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    "^LT0",
    "^LS0",
    // Do not override media type (^MN) — keep calibrated gap/mark setting
    "^PR4,4",
    "^MD15",
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

  // QA = automatic QR mode (most compatible on ZT411)
  lines.push(`^FO${qrX},${qrY}^BQN,2,${mag}^FDQA,${qrData}^FS`);

  if (footer) {
    lines.push(
      `^FO${pad},${height - footerH - pad}^A0N,${footerH},${footerH}^FB${textW},1,0,L,0^FD${footer}^FS`,
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
    size,
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
    size,
  );
}
