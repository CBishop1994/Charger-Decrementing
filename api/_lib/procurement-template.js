/**
 * Jira ticket templating for warehouse procurement bulk tickets.
 *
 * Placeholders:
 *   {{date}}       — Denver day key (YYYY-MM-DD)
 *   {{line_count}} — number of lines
 *   {{lines}}      — rendered multi-line list of order lines
 *
 * Per-line placeholders inside the lines block builder:
 *   creator, link, quantity, notes (notes omitted when empty)
 */

export const DEFAULT_JIRA_SUMMARY =
  "Warehouse Procurement Order — {{date}}";

export const DEFAULT_JIRA_DESCRIPTION = `Daily warehouse procurement order for {{date}} (America/Denver).

{{lines}}

— Submitted automatically by StockTag Warehouse Procurement`;

/**
 * @param {string} template
 * @param {Record<string, string | number>} vars
 */
export function applyTemplate(template, vars) {
  return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

/**
 * @typedef {{ created_by_name?: string, created_by_email?: string, link: string, quantity: number, notes?: string }} ProcLine
 */

/**
 * Format one order line for the Jira description.
 * Notes are omitted entirely when empty.
 * @param {ProcLine} line
 */
export function formatProcurementLine(line) {
  const creator =
    String(line.created_by_name ?? "").trim() ||
    String(line.created_by_email ?? "").trim() ||
    "Unknown";
  const link = String(line.link ?? "").trim();
  const qty = Number(line.quantity) || 0;
  const notes = String(line.notes ?? "").trim();
  let block = `* ${creator}\n  Link: ${link}\n  Quantity: ${qty}`;
  if (notes) {
    block += `\n  Notes: ${notes}`;
  }
  return block;
}

/**
 * @param {ProcLine[]} lines
 */
export function formatProcurementLinesBlock(lines) {
  if (!lines?.length) return "(no lines)";
  return lines.map(formatProcurementLine).join("\n\n");
}

/**
 * @param {{ summaryTemplate: string, descriptionTemplate: string, dayKey: string, lines: ProcLine[] }} opts
 */
export function renderProcurementTicket(opts) {
  const lineCount = opts.lines?.length ?? 0;
  const vars = {
    date: opts.dayKey,
    line_count: lineCount,
    lines: formatProcurementLinesBlock(opts.lines ?? []),
  };
  return {
    summary: applyTemplate(opts.summaryTemplate, vars).trim() || DEFAULT_JIRA_SUMMARY,
    description: applyTemplate(opts.descriptionTemplate, vars).trim(),
  };
}
