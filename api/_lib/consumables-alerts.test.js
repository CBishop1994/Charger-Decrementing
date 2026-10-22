/**
 * Consumables weekly alerts — classification + dry-run pipeline.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.PROCUREMENT_DRY_RUN = "true";
process.env.JIRA_PROJECT_KEY = "WH";
process.env.SLACK_CHANNEL_ID = "C123";
process.env.SLACK_PING_USER_ID = "U456";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.CONSUMABLES_ALERTS_DRY_RUN;

const { resetLocalMemoryDb } = await import("./local-memory-db.js");
const {
  APPROACHING_RATIO,
  classifyConsumableStock,
  qtyToOrder,
  withOpenOrderQuantities,
  buildConsumablesReport,
  renderConsumablesAlertTicket,
  denverWeekKey,
  runConsumablesWeeklyAlerts,
  createAutoRestockOrders,
} = await import("./consumables-alerts.js");
const { supabaseAdmin } = await import("./supabase-admin.js");
const { jiraDescriptionToAdf } = await import("./jira-client.js");
const {
  DEFAULT_JIRA_FOOTER,
  DEFAULT_JIRA_INTRO,
  DEFAULT_JIRA_SECTION_HEADING,
  DEFAULT_JIRA_SUMMARY,
  serializeAlertSettings,
} = await import("./consumables-alert-settings.js");

describe("consumables stock classification", () => {
  it("converts bold Jira report headings and order amounts to ADF", () => {
    const doc = jiraDescriptionToAdf(
      "## **Out of Stock (1)**\n- Widget: **order 4 ea**\nTotal: **4 units**",
    );
    assert.equal(doc.type, "doc");
    assert.equal(doc.content[0].type, "heading");
    assert.equal(doc.content[0].attrs.level, 2);
    assert.deepEqual(doc.content[0].content[0], {
      type: "text",
      text: "Out of Stock (1)",
      marks: [{ type: "strong" }],
    });
    assert.deepEqual(doc.content[1].content[1], {
      type: "text",
      text: "order 4 ea",
      marks: [{ type: "strong" }],
    });
    assert.deepEqual(doc.content[2].content[1], {
      type: "text",
      text: "4 units",
      marks: [{ type: "strong" }],
    });
  });
  it("orders buckets and applies approaching = min × 1.25", () => {
    assert.equal(APPROACHING_RATIO, 1.25);
    assert.equal(classifyConsumableStock({ quantity: 0, min_level: 10 }), "out_of_stock");
    assert.equal(classifyConsumableStock({ quantity: 5, min_level: 10 }), "below_minimum");
    assert.equal(classifyConsumableStock({ quantity: 10, min_level: 10 }), "below_minimum");
    // min 8 → approaching ceiling 10; qty 9 and 10 approach; 11 is good
    assert.equal(classifyConsumableStock({ quantity: 9, min_level: 8 }), "approaching");
    assert.equal(classifyConsumableStock({ quantity: 10, min_level: 8 }), "approaching");
    assert.equal(classifyConsumableStock({ quantity: 11, min_level: 8 }), "good");
  });

  it("honors a custom approaching ratio", () => {
    // min 10 × 1.5 = 15 approaching ceiling
    assert.equal(
      classifyConsumableStock({ quantity: 14, min_level: 10 }, 1.5),
      "approaching",
    );
    assert.equal(
      classifyConsumableStock({ quantity: 16, min_level: 10 }, 1.5),
      "good",
    );
  });

  it("builds report sections in required order", () => {
    const report = buildConsumablesReport([
      { name: "Z Good", quantity: 100, min_level: 10 },
      { name: "A Out", quantity: 0, min_level: 5 },
      { name: "B Below", quantity: 2, min_level: 5 },
      { name: "C Approach", quantity: 6, min_level: 5 },
    ]);
    assert.equal(report.counts.out_of_stock, 1);
    assert.equal(report.counts.below_minimum, 1);
    assert.equal(report.counts.approaching, 1);
    assert.equal(report.counts.good, 1);
    assert.equal(report.buckets.out_of_stock[0].name, "A Out");
    assert.equal(report.buckets.approaching[0].name, "C Approach");
    assert.equal(report.items?.length, 4);
    // Out: target 10, need 10; Below: target 10, need 8; Approach qty 6 min 5 → target 10 need 4
    assert.equal(report.buckets.out_of_stock[0].qty_to_order, 10);
    assert.equal(report.buckets.below_minimum[0].qty_to_order, 8);
    assert.equal(report.buckets.approaching[0].qty_to_order, 4);
    assert.equal(report.counts.units_to_order, 22);
    assert.equal(report.counts.skus_to_order, 3);

    const ticket = renderConsumablesAlertTicket({
      weekKey: "2026-W41",
      dayKey: "2026-10-05",
      report,
    });
    assert.equal(ticket.description.includes("Weekly consumables inventory report"), false);
    assert.equal(ticket.description.includes("Approaching ratio:"), false);
    assert.equal(ticket.description.includes("Timezone:"), false);
    assert.match(ticket.description, /^Summary:/);
    assert.match(ticket.description, /\*\*order 22 units\*\*/);
    assert.match(ticket.description, /· \*\*order 10 ea\*\*/);
    const outIdx = ticket.description.indexOf("## **Out of Stock (1)**");
    const belowIdx = ticket.description.indexOf("## **Below Minimum (1)**");
    const approachIdx = ticket.description.indexOf("## **Approaching minimum (1)**");
    const goodIdx = ticket.description.indexOf("## **Good");
    assert.ok(outIdx >= 0 && belowIdx > outIdx);
    assert.ok(approachIdx > belowIdx && goodIdx === -1);
    assert.match(ticket.description, /3 items requiring attention/);
    assert.ok(ticket.description.includes("Total additional quantity to order now: **22 units**"));
    assert.equal(ticket.description.includes("Z Good"), false);
    assert.equal(ticket.description.toLowerCase().includes("1 good"), false);
  });

  it("updates saved built-in Jira templates while preserving custom templates", () => {
    const settings = serializeAlertSettings({
      include_good: true,
      jira_summary_template:
        "Consumables weekly inventory {{week}}: {{out_count}} out, {{below_count}} below min, {{approaching_count}} approaching, {{good_count}} good",
      jira_intro_template:
        "Summary: {{out_count}} out of stock · {{below_count}} below minimum · {{approaching_count}} approaching · {{good_count}} good ({{total}} active items){{order_summary_clause}}",
      jira_section_heading_template: "## {{title}} ({{count}})",
      jira_footer_template:
        "Total additional quantity to order now: {{order_total}} units, after subtracting on-order stock (min × 2 target).",
    });
    assert.equal(settings.include_good, false);
    assert.equal(settings.jira_summary_template, DEFAULT_JIRA_SUMMARY);
    assert.equal(settings.jira_intro_template, DEFAULT_JIRA_INTRO);
    assert.equal(settings.jira_section_heading_template, DEFAULT_JIRA_SECTION_HEADING);
    assert.equal(settings.jira_footer_template, DEFAULT_JIRA_FOOTER);

    const custom = serializeAlertSettings({
      jira_summary_template: "Custom summary {{week}}",
    });
    assert.equal(custom.jira_summary_template, "Custom summary {{week}}");
  });

  it("subtracts on-hand and incoming quantities from the min × 2 target", () => {
    assert.equal(qtyToOrder(2, 5, 3), 5);
    assert.equal(qtyToOrder(2, 5, 12), 0);

    const report = buildConsumablesReport([
      {
        name: "Partially ordered item",
        quantity: 2,
        min_level: 5,
        quantity_on_order: 3,
        unit: "ea",
      },
    ]);
    assert.equal(report.items[0].restock_target, 10);
    assert.equal(report.items[0].quantity_on_order, 3);
    assert.equal(report.items[0].qty_to_order, 5);
    assert.equal(report.counts.units_to_order, 5);

    const ticket = renderConsumablesAlertTicket({ weekKey: "2026-W41", report });
    assert.ok(ticket.description.includes("**3 ea on order**"));
    assert.ok(ticket.description.includes("**order 5 units**"));
    assert.ok(
      ticket.description.includes(
        "Total additional quantity to order now: **5 units**",
      ),
    );
  });

  it("applies custom per-piece Jira templates", () => {
    const report = buildConsumablesReport([
      { name: "Out", quantity: 0, min_level: 5 },
    ]);
    const ticket = renderConsumablesAlertTicket({
      weekKey: "2026-W41",
      report,
      settings: {
        include_out_of_stock: true,
        include_below_minimum: false,
        include_approaching: false,
        include_good: false,
        jira_summary_template: "ALERT {{week}} order={{order_total}}",
        jira_intro_template: "Need {{order_total}} across {{skus_to_order}}",
        jira_section_heading_template: "### {{title}} x{{count}}",
        jira_item_line_template: "* {{name}} order={{order}}",
        jira_empty_section_template: "(empty)",
        jira_footer_template: "TOTAL {{order_total}}",
        jira_description_template: "{{intro}}\n\n{{sections}}\n\n{{footer}}",
      },
    });
    assert.equal(ticket.summary, "ALERT 2026-W41 order=10");
    assert.match(ticket.description, /^Need 10 across 1/);
    assert.match(ticket.description, /### Out of Stock x1/);
    assert.match(ticket.description, /\* Out order=10/);
    assert.match(ticket.description, /TOTAL 10/);
  });

  it("uses MPN in default Jira lines and preserves custom SKU placeholders", () => {
    const report = buildConsumablesReport([
      {
        name: "Anker - 8-in-1 USB-C Hub",
        sku: "ANK8IN1USBCH",
        mpn: "A83830A1",
        quantity: 0,
        min_level: 5,
      },
    ]);

    const defaultTicket = renderConsumablesAlertTicket({
      weekKey: "2026-W41",
      report,
    });
    assert.match(
      defaultTicket.description,
      /Anker - 8-in-1 USB-C Hub \[A83830A1\]/,
    );
    assert.equal(defaultTicket.description.includes("[ANK8IN1USBCH]"), false);

    const customTicket = renderConsumablesAlertTicket({
      weekKey: "2026-W41",
      report,
      settings: {
        include_out_of_stock: true,
        include_below_minimum: false,
        include_approaching: false,
        include_good: false,
        jira_item_line_template: "- {{name}}{{sku_part}} · MPN{{mpn_part}}",
      },
    });
    assert.match(
      customTicket.description,
      /Anker - 8-in-1 USB-C Hub \[ANK8IN1USBCH\] · MPN \[A83830A1\]/,
    );

    const migrated = serializeAlertSettings({
      jira_item_line_template:
        "- {{name}}{{sku_part}}: {{qty}} {{unit}} on hand (min {{min}}){{on_order_part}}{{order_part}}{{bin_part}}",
    });
    assert.match(migrated.jira_item_line_template, /{{mpn_part}}/);
    assert.doesNotMatch(migrated.jira_item_line_template, /{{sku_part}}/);
  });

  it("omits disabled report sections from the ticket", () => {
    const report = buildConsumablesReport([
      { name: "Out", quantity: 0, min_level: 5 },
      { name: "Good", quantity: 50, min_level: 5 },
    ]);
    const ticket = renderConsumablesAlertTicket({
      weekKey: "2026-W41",
      dayKey: "2026-10-05",
      report,
      settings: {
        approaching_ratio: 1.25,
        include_out_of_stock: true,
        include_below_minimum: true,
        include_approaching: true,
        include_good: false,
      },
    });
    assert.ok(ticket.description.includes("## **Out of Stock"));
    assert.equal(ticket.description.includes("## Good"), false);
  });

  it("returns a Denver ISO week key", () => {
    const key = denverWeekKey(new Date("2026-10-05T18:00:00Z"));
    assert.match(key, /^\d{4}-W\d{2}$/);
  });
});

describe("consumables alerts dry-run", () => {
  before(() => {
    resetLocalMemoryDb();
  });

  it("creates internal restock orders once per item and report week", async () => {
    resetLocalMemoryDb();
    const items = [
      { id: 11, name: "Widget", qty_to_order: 5 },
      { id: 12, name: "No restock needed", qty_to_order: 0 },
    ];

    const created = await createAutoRestockOrders(items, "2026-W41", "WH-123");
    assert.deepEqual(created, { count: 1, totalUnits: 5 });

    const { data: rows } = await supabaseAdmin
      .from("stock_orders")
      .select("*")
      .eq("auto_restock_week_key", "2026-W41");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].consumable_id, 11);
    assert.equal(rows[0].quantity_ordered, 5);
    assert.equal(rows[0].status, "ordered");
    assert.match(rows[0].note, /supplier purchase still needs to be placed manually/i);

    const duplicate = await createAutoRestockOrders(items, "2026-W41", "WH-123");
    assert.deepEqual(duplicate, { count: 0, totalUnits: 0 });
  });

  it("skips cron when weekly auto-run is disabled", async () => {
    resetLocalMemoryDb();
    const { ensureConsumablesAlertSettings } = await import(
      "./consumables-alert-settings.js"
    );
    await ensureConsumablesAlertSettings();
    await supabaseAdmin
      .from("consumables_alert_settings")
      .update({ weekly_enabled: false })
      .eq("id", 1);

    const weekKey = denverWeekKey();
    const result = await runConsumablesWeeklyAlerts({
      weekKey,
      dryRun: true,
      triggeredBy: "cron",
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "weekly_disabled");
  });

  it("skips Jira/Slack when there are no active items", async () => {
    resetLocalMemoryDb();
    const weekKey = denverWeekKey();
    const result = await runConsumablesWeeklyAlerts({
      weekKey,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_items");
    assert.equal(result.batch?.status, "empty_skipped");
  });

  it("skips Jira/Slack when every active item has a zero minimum", async () => {
    resetLocalMemoryDb();
    const now = new Date().toISOString();
    await supabaseAdmin.from("consumables").insert([
      {
        name: "Discontinued Item",
        sku: "DISC-0",
        quantity: 0,
        min_level: 0,
        unit: "ea",
        is_active: true,
        updated_at: now,
        created_at: now,
      },
    ]);

    const result = await runConsumablesWeeklyAlerts({
      weekKey: denverWeekKey(),
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_items");
    assert.equal(result.batch?.status, "empty_skipped");
    assert.match(result.message, /positive minimum stock level/);
  });

  it("subtracts open order balances and reports the additional Jira total", async () => {
    resetLocalMemoryDb();
    const now = new Date().toISOString();
    const { data: insertedItems } = await supabaseAdmin
      .from("consumables")
      .insert([
        {
          name: "Open Order Item",
          sku: "OPEN-1",
          quantity: 2,
          min_level: 5,
          unit: "ea",
          category: "Test",
          bin_location: "A-1",
          asset_tag: "T1",
          is_active: true,
          updated_at: now,
          created_at: now,
        },
      ])
      .select("id");
    const consumableId = insertedItems[0].id;

    await supabaseAdmin.from("stock_orders").insert([
      {
        consumable_id: consumableId,
        quantity_ordered: 6,
        quantity_received: 2,
        status: "ordered",
        note: "Partial delivery; balance en route",
        ordered_by: "test",
        received_by: "",
        ordered_at: now,
        delivered_at: "",
      },
      {
        consumable_id: consumableId,
        quantity_ordered: 10,
        quantity_received: 10,
        status: "delivered",
        note: "Already received",
        ordered_by: "test",
        received_by: "test",
        ordered_at: now,
        delivered_at: now,
      },
    ]);

    const result = await runConsumablesWeeklyAlerts({
      weekKey: denverWeekKey(),
      dryRun: true,
      triggeredBy: "test",
    });

    assert.equal(result.skipped, false);
    assert.equal(result.counts?.units_to_order, 4);
    assert.equal(result.counts?.skus_to_order, 1);
    assert.equal(result.report?.items[0]?.quantity_on_order, 4);
    assert.equal(result.report?.items[0]?.qty_to_order, 4);
    assert.ok(result.ticket?.description.includes("**order 4 units**"));
    assert.ok(
      result.ticket?.description.includes(
        "Total additional quantity to order now: **4 units**",
      ),
    );
    assert.ok(
      result.ticket?.description.includes(
        "2 ea on hand (min 5) · **4 ea on order** · **order 4 ea**",
      ),
    );
  });

  it("is idempotent for the same week", async () => {
    const weekKey = denverWeekKey();
    const again = await runConsumablesWeeklyAlerts({
      weekKey,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, "already_reported");
  });

  it("creates dry-run Jira + Slack with ordered counts", async () => {
    resetLocalMemoryDb();
    const weekKey = denverWeekKey();
    const now = new Date().toISOString();
    await supabaseAdmin.from("consumables").insert([
      {
        name: "Out Item",
        sku: "OUT-1",
        quantity: 0,
        min_level: 5,
        unit: "ea",
        category: "Test",
        bin_location: "A-1",
        asset_tag: "T1",
        is_active: true,
        updated_at: now,
        created_at: now,
      },
      {
        name: "Below Item",
        sku: "BEL-1",
        quantity: 2,
        min_level: 5,
        unit: "ea",
        category: "Test",
        bin_location: "A-2",
        asset_tag: "T2",
        is_active: true,
        updated_at: now,
        created_at: now,
      },
      {
        name: "Approach Item",
        sku: "APP-1",
        quantity: 6,
        min_level: 5,
        unit: "ea",
        category: "Test",
        bin_location: "A-3",
        asset_tag: "T3",
        is_active: true,
        updated_at: now,
        created_at: now,
      },
      {
        name: "Good Item",
        sku: "GOOD-1",
        quantity: 50,
        min_level: 5,
        unit: "ea",
        category: "Test",
        bin_location: "A-4",
        asset_tag: "T4",
        is_active: true,
        updated_at: now,
        created_at: now,
      },
      {
        name: "No Reorder Item",
        sku: "NO-ORDER-1",
        quantity: 0,
        min_level: 0,
        unit: "ea",
        category: "Test",
        bin_location: "A-5",
        asset_tag: "T6",
        is_active: true,
        updated_at: now,
        created_at: now,
      },
      {
        name: "Inactive",
        sku: "INACT",
        quantity: 0,
        min_level: 1,
        unit: "ea",
        category: "Test",
        bin_location: "",
        asset_tag: "T5",
        is_active: false,
        updated_at: now,
        created_at: now,
      },
    ]);

    const result = await runConsumablesWeeklyAlerts({
      weekKey,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(result.skipped, false);
    assert.equal(result.reason, "submitted");
    assert.equal(result.counts?.out_of_stock, 1);
    assert.equal(result.counts?.below_minimum, 1);
    assert.equal(result.counts?.approaching, 1);
    assert.equal(result.counts?.good, 1);
    assert.equal(result.counts?.total, 4);
    assert.ok(result.issue?.key);
    assert.equal(result.issue?.dryRun, true);
    assert.equal(result.slack?.dryRun, true);
    assert.ok(result.ticket?.description.includes("## **Out of Stock"));
    assert.match(result.ticket?.description ?? "", /Approach Item/);
    assert.doesNotMatch(result.ticket?.description ?? "", /No Reorder Item/);
    assert.equal(result.report?.items.some((item) => item.name === "No Reorder Item"), false);

    const forced = await runConsumablesWeeklyAlerts({
      weekKey,
      dryRun: true,
      force: true,
      triggeredBy: "test",
    });
    assert.equal(forced.skipped, false);
    assert.equal(forced.reason, "submitted");
  });
});
