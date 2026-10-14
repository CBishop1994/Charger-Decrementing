/**
 * Dry-run close pipeline against in-memory DB (no Slack/Jira HTTP).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.PROCUREMENT_DRY_RUN = "true";
process.env.JIRA_PROJECT_KEY = "WH";
process.env.SLACK_CHANNEL_ID = "C123";
process.env.SLACK_PING_USER_ID = "U456";
// Ensure local memory path (no real Supabase)
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { resetLocalMemoryDb } = await import("./local-memory-db.js");
const { denverDayKey, nextDenverDayKey } = await import("./denver-day.js");
const { runProcurementClose } = await import("./procurement-close.js");
const { supabaseAdmin } = await import("./supabase-admin.js");
const { ensureProcurementSettings } = await import("./procurement-settings.js");
const { handleProcurement } = await import("./procurement-handlers.js");

describe("procurement close dry-run", () => {
  before(() => {
    resetLocalMemoryDb();
  });

  it("skips Jira/Slack when there are no open lines", async () => {
    resetLocalMemoryDb();
    await ensureProcurementSettings();
    const dayKey = denverDayKey();
    const result = await runProcurementClose({
      dayKey,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_orders");
    assert.equal(result.batch?.status, "empty_skipped");
  });

  it("is idempotent for the same day", async () => {
    const dayKey = denverDayKey();
    const again = await runProcurementClose({
      dayKey,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, "already_closed");
  });

  it("creates dry-run Jira + Slack when lines exist", async () => {
    resetLocalMemoryDb();
    await ensureProcurementSettings();
    const dayKey = denverDayKey();
    const now = new Date().toISOString();
    await supabaseAdmin.from("procurement_order_lines").insert({
      day_key: dayKey,
      link: "https://example.com/item",
      quantity: 2,
      notes: "note me",
      created_by_email: "dev@localhost",
      created_by_name: "Local Dev",
      status: "open",
      updated_at: now,
      created_at: now,
    });

    const result = await runProcurementClose({
      dayKey,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(result.skipped, false);
    assert.equal(result.reason, "submitted");
    assert.equal(result.lineCount, 1);
    assert.ok(result.issue?.key);
    assert.ok(result.issue?.url);
    assert.equal(result.issue?.dryRun, true);
    assert.equal(result.slack?.dryRun, true);
    assert.match(result.ticket?.description ?? "", /Notes: note me/);

    const { data: lines } = await supabaseAdmin
      .from("procurement_order_lines")
      .select("*")
      .eq("day_key", dayKey);
    assert.equal(lines?.[0]?.status, "submitted");
  });

  it("queues new lines onto tomorrow after today is closed", async () => {
    resetLocalMemoryDb();
    await ensureProcurementSettings();
    const dayKey = denverDayKey();
    const tomorrow = nextDenverDayKey(dayKey);
    const now = new Date().toISOString();

    await supabaseAdmin.from("procurement_order_lines").insert({
      day_key: dayKey,
      link: "https://example.com/today-item",
      quantity: 1,
      notes: "",
      created_by_email: "dev@localhost",
      created_by_name: "Local Dev",
      status: "open",
      updated_at: now,
      created_at: now,
    });

    const closed = await runProcurementClose({
      dayKey,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(closed.skipped, false);
    assert.equal(closed.reason, "submitted");

    const auth = {
      email: "dev@localhost",
      name: "Local Dev",
      isAdmin: true,
    };

    /** @type {any} */
    let postStatus = 0;
    /** @type {any} */
    let postBody = null;
    await handleProcurement(
      {
        method: "POST",
        query: {},
        body: {
          link: "https://example.com/tomorrow-item",
          quantity: 3,
          notes: "queue me",
        },
      },
      {
        status(code) {
          postStatus = code;
          return this;
        },
        json(payload) {
          postBody = payload;
          return payload;
        },
        setHeader() {},
      },
      auth,
      null,
      "",
    );
    assert.equal(postStatus, 201);
    assert.equal(postBody.day_key, tomorrow);
    assert.equal(postBody.status, "open");

    /** @type {any} */
    let statusBody = null;
    await handleProcurement(
      { method: "GET", query: { action: "status" }, body: {} },
      {
        status() {
          return this;
        },
        json(payload) {
          statusBody = payload;
          return payload;
        },
        setHeader() {},
      },
      auth,
      null,
      "status",
    );
    assert.equal(statusBody.locked, true);
    assert.equal(statusBody.day_key, dayKey);
    assert.equal(statusBody.queue_day_key, tomorrow);
    assert.equal(statusBody.open_count, 1);
    assert.equal(statusBody.submitted_count, 1);

    /** @type {any} */
    let listBody = null;
    await handleProcurement(
      { method: "GET", query: {}, body: {} },
      {
        status() {
          return this;
        },
        json(payload) {
          listBody = payload;
          return payload;
        },
        setHeader() {},
      },
      auth,
      null,
      "",
    );
    assert.equal(listBody.length, 1);
    assert.equal(listBody[0].day_key, tomorrow);
    assert.equal(listBody[0].link, "https://example.com/tomorrow-item");

    // Tomorrow's close picks up the queued line; today's batch stays untouched.
    const tomorrowClose = await runProcurementClose({
      dayKey: tomorrow,
      dryRun: true,
      triggeredBy: "test",
    });
    assert.equal(tomorrowClose.skipped, false);
    assert.equal(tomorrowClose.lineCount, 1);

    const { data: todayLines } = await supabaseAdmin
      .from("procurement_order_lines")
      .select("*")
      .eq("day_key", dayKey);
    assert.equal(todayLines?.length, 1);
    assert.equal(todayLines?.[0]?.status, "submitted");
    assert.equal(todayLines?.[0]?.link, "https://example.com/today-item");

    const { data: tomorrowLines } = await supabaseAdmin
      .from("procurement_order_lines")
      .select("*")
      .eq("day_key", tomorrow);
    assert.equal(tomorrowLines?.[0]?.status, "submitted");
  });
});
