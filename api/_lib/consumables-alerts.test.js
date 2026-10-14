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
  buildConsumablesReport,
  renderConsumablesAlertTicket,
  denverWeekKey,
  runConsumablesWeeklyAlerts,
} = await import("./consumables-alerts.js");
const { supabaseAdmin } = await import("./supabase-admin.js");

describe("consumables stock classification", () => {
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
    assert.match(ticket.description, /order 22 units/);
    assert.match(ticket.description, /· order 10 ea/);
    const outIdx = ticket.description.indexOf("## Out of Stock");
    const belowIdx = ticket.description.indexOf("## Below minimum");
    const approachIdx = ticket.description.indexOf("## Approaching minimum");
    const goodIdx = ticket.description.indexOf("## Good");
    assert.ok(outIdx >= 0 && belowIdx > outIdx);
    assert.ok(approachIdx > belowIdx && goodIdx > approachIdx);
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
    assert.match(ticket.description, /## Out of Stock/);
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
    assert.match(result.ticket?.description ?? "", /## Out of Stock/);
    assert.match(result.ticket?.description ?? "", /Approach Item/);

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
