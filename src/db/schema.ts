import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  real,
  timestamp,
} from "drizzle-orm/pg-core";

/** Consumable inventory items tracked by quantity and reorder threshold. */
export const consumables = pgTable("consumables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  description: text("description").notNull().default(""),
  quantity: integer("quantity").notNull().default(0),
  min_level: integer("min_level").notNull().default(0),
  unit: text("unit").notNull().default("ea"),
  category: text("category").notNull().default("General"),
  bin_location: text("bin_location").notNull().default(""),
  asset_tag: text("asset_tag").notNull().default(""),
  notes: text("notes").notNull().default(""),
  is_active: boolean("is_active").notNull().default(true),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Audit log of stock decrements / restocks. */
export const stock_transactions = pgTable("stock_transactions", {
  id: serial("id").primaryKey(),
  consumable_id: integer("consumable_id").notNull(),
  change_amount: integer("change_amount").notNull(),
  previous_quantity: integer("previous_quantity").notNull(),
  new_quantity: integer("new_quantity").notNull(),
  reason: text("reason").notNull().default("adjust"),
  note: text("note").notNull().default(""),
  created_by: text("created_by").notNull().default("operator"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Physical bin / shelf locations that can receive location asset tags. */
export const bin_locations = pgTable("bin_locations", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  zone: text("zone").notNull().default(""),
  aisle: text("aisle").notNull().default(""),
  shelf: text("shelf").notNull().default(""),
  description: text("description").notNull().default(""),
  asset_tag: text("asset_tag").notNull().default(""),
  is_active: boolean("is_active").notNull().default(true),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Network asset-tag printer configuration (e.g. Zebra on port 9100). */
export const printer_settings = pgTable("printer_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(9100),
  protocol: text("protocol").notNull().default("zpl"),
  // Default 4×2 in (101.6 × 50.8 mm) — common ZT411 stock
  label_width_mm: real("label_width_mm").notNull().default(101.6),
  label_height_mm: real("label_height_mm").notNull().default(50.8),
  dpi: integer("dpi").notNull().default(203),
  is_default: boolean("is_default").notNull().default(false),
  notes: text("notes").notNull().default(""),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * Google accounts allowed to sign in. Emails are stored lowercase.
 * The first successful Google sign-in seeds this table as admin when empty.
 */
export const approved_emails = pgTable("approved_emails", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  is_admin: boolean("is_admin").notNull().default(false),
  created_by: text("created_by").notNull().default("system"),
  notes: text("notes").notNull().default(""),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
