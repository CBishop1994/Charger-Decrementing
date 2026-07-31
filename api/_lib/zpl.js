/** ZPL helpers for asset-tag / bin-location labels (Zebra-compatible). */

function mmToDots(mm, dpi = 203) {
  return Math.round((mm / 25.4) * dpi);
}

function escapeZpl(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, " ")
    .replace(/~/g, " ")
    .slice(0, 64);
}

/**
 * Magnification for ^BQ based on label height so the QR stays scannable
 * without overflowing a small asset tag.
 */
function qrMagnification(heightDots, dpi) {
  const target = Math.floor(heightDots * 0.48);
  const mag = Math.round(target / 29);
  return Math.min(10, Math.max(3, mag || (dpi >= 300 ? 4 : 3)));
}

/** Build a compact asset-tag ZPL label with a QR code. */
export function buildAssetTagZpl(
  payload,
  size = { widthMm: 50, heightMm: 25, dpi: 203 },
) {
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

  const lines = [
    "^XA",
    "^CI28",
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

  // QR code on the right — Model 2, medium error correction via MA mode
  lines.push(`^FO${qrX},${qrY}^BQN,2,${mag}^FDMA,${qrData}^FS`);

  if (footer) {
    lines.push(
      `^FO16,${height - 20}^A0N,14,14^FB${textMaxX - 16},1,0,L,0^FD${footer}^FS`,
    );
  }

  lines.push("^XZ");
  return lines.join("\n");
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
