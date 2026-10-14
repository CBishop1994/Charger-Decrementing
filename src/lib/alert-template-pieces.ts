/** Stable IDs for individually editable alert Jira template pieces. */

export const ALERT_TEMPLATE_PIECE_IDS = [
  "issue_summary",
  "intro",
  "section_heading",
  "item_line",
  "empty_section",
  "footer",
  "layout",
] as const;

export type AlertTemplatePieceId = (typeof ALERT_TEMPLATE_PIECE_IDS)[number];

export type AlertTemplatePieceField =
  | "jira_summary_template"
  | "jira_intro_template"
  | "jira_section_heading_template"
  | "jira_item_line_template"
  | "jira_empty_section_template"
  | "jira_footer_template"
  | "jira_description_template";

export type AlertTemplatePieceDef = {
  id: AlertTemplatePieceId;
  field: AlertTemplatePieceField;
  label: string;
  /** Shown under the piece selector for the active piece. */
  hint: string;
  rows: number;
  /** false = Jira issue title; true = part of ticket description. */
  isDescription: boolean;
};

export const ALERT_TEMPLATE_PIECES: AlertTemplatePieceDef[] = [
  {
    id: "issue_summary",
    field: "jira_summary_template",
    label: "Issue summary",
    hint: "{{week}}, {{out_count}}, {{below_count}}, {{approaching_count}}, {{good_count}}, {{total}}, {{order_total}}, {{skus_to_order}}",
    rows: 2,
    isDescription: false,
  },
  {
    id: "intro",
    field: "jira_intro_template",
    label: "Intro",
    hint: "Count placeholders + {{order_summary_clause}} (empty when nothing to order)",
    rows: 3,
    isDescription: true,
  },
  {
    id: "section_heading",
    field: "jira_section_heading_template",
    label: "Section heading",
    hint: "{{title}}, {{count}}, {{key}}",
    rows: 2,
    isDescription: true,
  },
  {
    id: "item_line",
    field: "jira_item_line_template",
    label: "Item line",
    hint: "{{name}}, {{sku}}, {{qty}}, {{min}}, {{unit}}, {{bin}}, {{order}}, {{restock_target}}, {{sku_part}}, {{order_part}}, {{bin_part}}",
    rows: 3,
    isDescription: true,
  },
  {
    id: "empty_section",
    field: "jira_empty_section_template",
    label: "Empty section",
    hint: "Shown when a status bucket has no SKUs",
    rows: 2,
    isDescription: true,
  },
  {
    id: "footer",
    field: "jira_footer_template",
    label: "Footer",
    hint: "{{order_total}}, {{skus_to_order}}, and count placeholders",
    rows: 2,
    isDescription: true,
  },
  {
    id: "layout",
    field: "jira_description_template",
    label: "Layout",
    hint: "Assembles pieces: {{intro}}, {{sections}}, {{footer}}",
    rows: 4,
    isDescription: true,
  },
];

export const DEFAULT_ALERT_TEMPLATE_VALUES: Record<
  AlertTemplatePieceField,
  string
> = {
  jira_summary_template:
    "Consumables weekly inventory {{week}}: {{out_count}} out, {{below_count}} below min, {{approaching_count}} approaching, {{good_count}} good",
  jira_intro_template:
    "Summary: {{out_count}} out of stock · {{below_count}} below minimum · {{approaching_count}} approaching · {{good_count}} good ({{total}} active items){{order_summary_clause}}",
  jira_section_heading_template: "## {{title}} ({{count}})",
  jira_item_line_template:
    "- {{name}}{{sku_part}}: {{qty}} {{unit}} on hand (min {{min}}){{order_part}}{{bin_part}}",
  jira_empty_section_template: "(none)",
  jira_footer_template:
    "Order total: {{order_total}} units to reach restock target (min × 2).",
  jira_description_template: "{{intro}}\n\n{{sections}}\n\n{{footer}}",
};

export function getAlertTemplatePiece(
  id: AlertTemplatePieceId,
): AlertTemplatePieceDef {
  const piece = ALERT_TEMPLATE_PIECES.find((p) => p.id === id);
  if (!piece) return ALERT_TEMPLATE_PIECES[0]!;
  return piece;
}
