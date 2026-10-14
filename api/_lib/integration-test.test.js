import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

const saved = {
  PROCUREMENT_DRY_RUN: process.env.PROCUREMENT_DRY_RUN,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
  JIRA_BASE_URL: process.env.JIRA_BASE_URL,
  JIRA_EMAIL: process.env.JIRA_EMAIL,
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
  JIRA_PROJECT_KEY: process.env.JIRA_PROJECT_KEY,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

before(() => {
  process.env.NODE_ENV = "development";
  delete process.env.VERCEL_ENV;
  process.env.PROCUREMENT_DRY_RUN = "true";
  process.env.SLACK_CHANNEL_ID = "C123";
  process.env.JIRA_PROJECT_KEY = "WH";
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const { runIntegrationTests, summarizeIntegrationTest } = await import(
  "./integration-test.js"
);

describe("integration test probes", () => {
  it("dry-run auth reports OK without HTTP", async () => {
    const r = await runIntegrationTests({
      targets: "both",
      mode: "auth",
      dryRun: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.dry_run, true);
    assert.equal(r.slack?.ok, true);
    assert.equal(r.jira?.ok, true);
    assert.match(String(r.message), /Dry-run/i);
  });

  it("live auth with missing Slack token fails Slack only", async () => {
    const r = await runIntegrationTests({
      targets: "slack",
      mode: "auth",
      dryRun: false,
    });
    assert.equal(r.ok, false);
    assert.equal(r.slack?.ok, false);
    assert.match(String(r.slack?.error), /SLACK_BOT_TOKEN/i);
  });

  it("live auth rejects non-xoxb Slack token", async () => {
    process.env.SLACK_BOT_TOKEN = "not-a-bot-token";
    try {
      const r = await runIntegrationTests({
        targets: "slack",
        mode: "auth",
        dryRun: false,
      });
      assert.equal(r.ok, false);
      assert.match(String(r.slack?.error), /xoxb-/i);
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
    }
  });

  it("summarizeIntegrationTest joins statuses", () => {
    const msg = summarizeIntegrationTest({
      dry_run: false,
      slack: { ok: true },
      jira: { ok: false, error: "boom" },
    });
    assert.match(msg, /Live/);
    assert.match(msg, /Slack OK/);
    assert.match(msg, /Jira FAIL/);
  });
});
