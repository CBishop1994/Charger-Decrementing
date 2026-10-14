import type { ConsumablesAlertSkuRow } from "@/lib/api";

const STATUS_SECTIONS = [
  { key: "out_of_stock", title: "Out of Stock", include: "include_out_of_stock" },
  { key: "below_minimum", title: "Below Minimum", include: "include_below_minimum" },
  { key: "approaching", title: "Approaching minimum", include: "include_approaching" },
] as const;

export type AlertTemplateDraft = {
  include_out_of_stock: boolean;
  include_below_minimum: boolean;
  include_approaching: boolean;
  include_good: boolean;
  jira_summary_template: string;
  jira_intro_template: string;
  jira_section_heading_template: string;
  jira_item_line_template: string;
  jira_empty_section_template: string;
  jira_footer_template: string;
  jira_description_template?: string;
};

function applyTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return String(template ?? "").replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, key: string) => {
      const v = vars[key];
      return v == null ? "" : String(v);
    },
  );
}

function formatItemLine(
  item: ConsumablesAlertSkuRow,
  itemLineTpl: string,
): string {
  const name = item.name || "Item";
  const sku = (item.sku || "").trim();
  const qty = Number(item.quantity) || 0;
  const min = Number(item.min_level) || 0;
  const unit = (item.unit || "ea").trim() || "ea";
  const bin = (item.bin_location || "").trim();
  const onOrder = Math.max(0, Math.trunc(Number(item.quantity_on_order) || 0));
  const order = Number(item.qty_to_order) || 0;
  const target = Number(item.restock_target) || min * 2;
  return applyTemplate(itemLineTpl, {
    name,
    sku,
    qty,
    min,
    unit,
    bin,
    order,
    restock_target: target,
    sku_part: sku ? ` [${sku}]` : "",
    on_order_part: onOrder > 0 ? ` · **${onOrder} ${unit} on order**` : "",
    order_part: order > 0 ? ` · **order ${order} ${unit}**` : "",
    bin_part: bin ? ` · bin ${bin}` : "",
  }).trimEnd();
}

/** Client-side preview matching server `renderConsumablesAlertTicket`. */
export function previewAlertTicket(opts: {
  weekKey: string;
  items: ConsumablesAlertSkuRow[];
  draft: AlertTemplateDraft;
}): { summary: string; description: string } {
  const items = (opts.items ?? []).filter(
    (item) => Number(item.min_level) > 0,
  );
  const byStatus = {
    out_of_stock: items.filter((i) => i.status === "out_of_stock"),
    below_minimum: items.filter((i) => i.status === "below_minimum"),
    approaching: items.filter((i) => i.status === "approaching"),
    good: items.filter((i) => i.status === "good"),
  };
  const counts = {
    out_of_stock: byStatus.out_of_stock.length,
    below_minimum: byStatus.below_minimum.length,
    approaching: byStatus.approaching.length,
    good: byStatus.good.length,
    total: items.length,
    units_to_order: items.reduce(
      (sum, row) => sum + (Number(row.qty_to_order) || 0),
      0,
    ),
    skus_to_order: items.filter((row) => (Number(row.qty_to_order) || 0) > 0)
      .length,
  };

  const headingTpl = opts.draft.jira_section_heading_template.trim();
  const itemTpl = opts.draft.jira_item_line_template.trim();
  const emptyTpl = opts.draft.jira_empty_section_template.trim() || "(none)";

  const sectionLines: string[] = [];
  for (const section of STATUS_SECTIONS) {
    if (!opts.draft[section.include]) continue;
    const rows = byStatus[section.key];
    sectionLines.push(
      applyTemplate(headingTpl, {
        title: section.title,
        count: rows.length,
        key: section.key,
      }).trimEnd(),
    );
    if (rows.length === 0) {
      sectionLines.push(emptyTpl);
    } else {
      for (const item of rows) sectionLines.push(formatItemLine(item, itemTpl));
    }
    sectionLines.push("");
  }
  if (sectionLines.length === 0) {
    sectionLines.push(
      applyTemplate(headingTpl, {
        title: "(no sections enabled in alert settings)",
        count: 0,
        key: "none",
      }).trimEnd(),
    );
    sectionLines.push(emptyTpl);
  }

  const orderTotal = counts.units_to_order;
  const countVars = {
    week: opts.weekKey,
    out_count: counts.out_of_stock,
    below_count: counts.below_minimum,
    approaching_count: counts.approaching,
    good_count: counts.good,
    total: counts.total,
    report_total: counts.out_of_stock + counts.below_minimum + counts.approaching,
    order_total: orderTotal,
    skus_to_order: counts.skus_to_order,
    order_summary_clause:
      orderTotal > 0 ? ` · **order ${orderTotal} units**` : "",
  };

  const intro = applyTemplate(
    opts.draft.jira_intro_template.trim(),
    countVars,
  ).trim();
  const footer = applyTemplate(
    opts.draft.jira_footer_template.trim(),
    countVars,
  ).trim();
  const sections = sectionLines.join("\n").trim();

  let layout =
    opts.draft.jira_description_template?.trim() ||
    "{{intro}}\n\n{{sections}}\n\n{{footer}}";
  if (layout.includes("{{summary_line}}") && !layout.includes("{{intro}}")) {
    layout = layout.replace(/\{\{\s*summary_line\s*\}\}/g, "{{intro}}");
  }

  return {
    summary: applyTemplate(opts.draft.jira_summary_template.trim(), countVars)
      .trim()
      .slice(0, 255),
    description: applyTemplate(layout, {
      ...countVars,
      intro,
      sections,
      footer,
      summary_line: intro,
    }).trim(),
  };
}
