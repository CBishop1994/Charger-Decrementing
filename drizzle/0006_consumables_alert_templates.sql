-- Jira ticket templates for weekly consumables / decrement alerts.
-- Apply on Supabase before using alert template editor in production.

ALTER TABLE "consumables_alert_settings"
  ADD COLUMN IF NOT EXISTS "jira_summary_template" TEXT NOT NULL
    DEFAULT 'Consumables weekly inventory {{week}}: {{out_count}} out, {{below_count}} below min, {{approaching_count}} approaching, {{good_count}} good';

ALTER TABLE "consumables_alert_settings"
  ADD COLUMN IF NOT EXISTS "jira_description_template" TEXT NOT NULL
    DEFAULT E'{{summary_line}}\n\n{{sections}}\n\nOrder total: {{order_total}} units to reach restock target (min × 2).';
