import { boolean, integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const consumables = pgTable("consumables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  mpn: text("mpn"),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  min_level: integer("min_level").notNull(),
  unit: text("unit").notNull(),
  category: text("category").notNull(),
  bin_location: text("bin_location").notNull(),
  asset_tag: text("asset_tag").notNull(),
  notes: text("notes").notNull(),
  is_active: boolean("is_active").notNull(),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const stock_transactions = pgTable("stock_transactions", {
  id: serial("id").primaryKey(),
  consumable_id: integer("consumable_id").notNull(),
  change_amount: integer("change_amount").notNull(),
  previous_quantity: integer("previous_quantity").notNull(),
  new_quantity: integer("new_quantity").notNull(),
  reason: text("reason").notNull(),
  note: text("note").notNull(),
  created_by: text("created_by").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const stock_orders = pgTable(
  "stock_orders",
  {
    id: serial("id").primaryKey(),
    consumable_id: integer("consumable_id").notNull(),
    quantity_ordered: integer("quantity_ordered").notNull(),
    quantity_received: integer("quantity_received"),
    status: text("status").notNull(),
    note: text("note").notNull(),
    ordered_by: text("ordered_by").notNull(),
    received_by: text("received_by").notNull(),
    ordered_at: text("ordered_at"),
    delivered_at: text("delivered_at"),
    auto_restock_week_key: text("auto_restock_week_key"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    autoRestockPerItemWeek: uniqueIndex(
      "stock_orders_auto_restock_item_week_uidx",
    ).on(table.consumable_id, table.auto_restock_week_key),
  }),
);

export const bin_locations = pgTable("bin_locations", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  zone: text("zone").notNull(),
  aisle: text("aisle").notNull(),
  shelf: text("shelf").notNull(),
  description: text("description").notNull(),
  asset_tag: text("asset_tag").notNull(),
  is_active: boolean("is_active").notNull(),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const printer_settings = pgTable("printer_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  protocol: text("protocol").notNull(),
  label_width_mm: real("label_width_mm").notNull(),
  label_height_mm: real("label_height_mm").notNull(),
  dpi: integer("dpi").notNull(),
  is_default: boolean("is_default").notNull(),
  notes: text("notes").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const approved_emails = pgTable("approved_emails", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  is_admin: boolean("is_admin").notNull(),
  created_by: text("created_by").notNull(),
  notes: text("notes").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const procurement_order_lines = pgTable("procurement_order_lines", {
  id: serial("id").primaryKey(),
  day_key: text("day_key").notNull(),
  link: text("link").notNull(),
  quantity: integer("quantity").notNull(),
  notes: text("notes").notNull(),
  created_by_email: text("created_by_email").notNull(),
  created_by_name: text("created_by_name").notNull(),
  status: text("status").notNull(),
  batch_id: integer("batch_id"),
  submitted_at: text("submitted_at"),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const procurement_batches = pgTable("procurement_batches", {
  id: serial("id").primaryKey(),
  day_key: text("day_key").notNull(),
  status: text("status").notNull(),
  line_count: integer("line_count").notNull(),
  jira_issue_key: text("jira_issue_key").notNull(),
  jira_issue_url: text("jira_issue_url").notNull(),
  slack_channel_id: text("slack_channel_id").notNull(),
  slack_message_ts: text("slack_message_ts").notNull(),
  dry_run: boolean("dry_run").notNull(),
  error_message: text("error_message").notNull(),
  submitted_at: text("submitted_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const procurement_settings = pgTable("procurement_settings", {
  id: serial("id").primaryKey(),
  jira_summary_template: text("jira_summary_template").notNull(),
  jira_description_template: text("jira_description_template").notNull(),
  slack_channel_id: text("slack_channel_id").notNull(),
  slack_ping_user_id: text("slack_ping_user_id").notNull(),
  jira_project_key: text("jira_project_key").notNull(),
  jira_issue_type: text("jira_issue_type").notNull(),
  updated_by: text("updated_by").notNull(),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const consumables_alert_settings = pgTable("consumables_alert_settings", {
  id: serial("id").primaryKey(),
  approaching_ratio: real("approaching_ratio").notNull(),
  weekly_enabled: boolean("weekly_enabled").notNull(),
  include_out_of_stock: boolean("include_out_of_stock").notNull(),
  include_below_minimum: boolean("include_below_minimum").notNull(),
  include_approaching: boolean("include_approaching").notNull(),
  include_good: boolean("include_good").notNull(),
  schedule_weekday: integer("schedule_weekday").notNull(),
  schedule_hour_mst: integer("schedule_hour_mst").notNull(),
  slack_channel_id: text("slack_channel_id").notNull(),
  slack_ping_user_id: text("slack_ping_user_id").notNull(),
  jira_project_key: text("jira_project_key").notNull(),
  jira_issue_type: text("jira_issue_type").notNull(),
  jira_summary_template: text("jira_summary_template").notNull(),
  jira_intro_template: text("jira_intro_template").notNull(),
  jira_section_heading_template: text("jira_section_heading_template").notNull(),
  jira_item_line_template: text("jira_item_line_template").notNull(),
  jira_empty_section_template: text("jira_empty_section_template").notNull(),
  jira_footer_template: text("jira_footer_template").notNull(),
  jira_description_template: text("jira_description_template").notNull(),
  updated_by: text("updated_by").notNull(),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const consumables_alert_batches = pgTable("consumables_alert_batches", {
  id: serial("id").primaryKey(),
  week_key: text("week_key").notNull(),
  status: text("status").notNull(),
  item_count: integer("item_count").notNull(),
  out_of_stock_count: integer("out_of_stock_count").notNull(),
  below_minimum_count: integer("below_minimum_count").notNull(),
  approaching_count: integer("approaching_count").notNull(),
  good_count: integer("good_count").notNull(),
  jira_issue_key: text("jira_issue_key").notNull(),
  jira_issue_url: text("jira_issue_url").notNull(),
  slack_channel_id: text("slack_channel_id").notNull(),
  slack_message_ts: text("slack_message_ts").notNull(),
  dry_run: boolean("dry_run").notNull(),
  error_message: text("error_message").notNull(),
  submitted_at: text("submitted_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});
