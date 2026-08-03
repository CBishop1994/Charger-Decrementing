export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(
  content: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
) {
  // Prefer text/plain so Windows / Zebra utilities treat it as a text job file.
  // Avoid UTF-8 BOM — some Zebra tools reject BOM-prefixed ZPL.
  downloadBlob(new Blob([content], { type: mime }), filename);
}

/** Copy text to clipboard (for pasting into Zebra Setup Utilities, etc.). */
export async function copyText(content: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = content;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}
