-- Break weekly alert Jira description into individually editable templates.
-- Apply on Supabase before using the piece template editor in production.

ALTER TABLE "consumables_alert_settings"
  ADD COLUMN IF NOT EXISTS "jira_intro_template" TEXT NOT NULL
    DEFAULT 'Summary: {{out_count}} out of stock · {{below_count}} below minimum · {{approaching_count}} approaching · {{good_count}} good ({{total}} active items){{order_summary_clause}}';

ALTER TABLE "consumables_alert_settings"
  ADD COLUMN IF NOT EXISTS "jira_section_heading_template" TEXT NOT NULL
    DEFAULT '## {{title}} ({{count}})';

ALTER TABLE "consumables_alert_settings"
  ADD COLUMN IF NOT EXISTS "jira_item_line_template" TEXT NOT NULL
    DEFAULT '- {{name}}{{sku_part}}: {{qty}} {{unit}} on hand (min {{min}}){{order_part}}{{bin_part}}';

ALTER TABLE "consumables_alert_settings"
  ADD COLUMN IF NOT EXISTS "jira_empty_section_template" TEXT NOT NULL
    DEFAULT '(none)';

ALTER TABLE "consumables_alert_settings"
  ADD COLUMN IF NOT EXISTS "jira_footer_template" TEXT NOT NULL
    DEFAULT 'Order total: {{order_total}} units to reach restock target (min × 2).';

-- Layout now composes the piece templates (intro / sections / footer).
ALTER TABLE "consumables_alert_settings"
  ALTER COLUMN "jira_description_template"
  SET DEFAULT E'{{intro}}\n\n{{sections}}\n\n{{footer}}';

UPDATE "consumables_alert_settings"
SET "jira_description_template" = E'{{intro}}\n\n{{sections}}\n\n{{footer}}'
WHERE "jira_description_template" = E'{{summary_line}}\n\n{{sections}}\n\nOrder total: {{order_total}} units to reach restock target (min × 2).'
   OR "jira_description_template" IS NULL
   OR TRIM("jira_description_template") = '';
