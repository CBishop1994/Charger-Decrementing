/**
 * Dry-run resolution: env vs auto vs partial live config.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.DEV_LOGIN_ENABLED = "true";

const saved = {
  PROCUREMENT_DRY_RUN: process.env.PROCUREMENT_DRY_RUN,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
  JIRA_BASE_URL: process.env.JIRA_BASE_URL,
  JIRA_EMAIL: process.env.JIRA_EMAIL,
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
  JIRA_PROJECT_KEY: process.env.JIRA_PROJECT_KEY,
};

const { resolveIntegrationDryRun } = await import("./integration-dry-run.js");
const { getSlackConfig, postSlackMessage } = await import("./slack-client.js");

describe("resolveIntegrationDryRun", () => {
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("honors PROCUREMENT_DRY_RUN=true as env reason", () => {
    process.env.PROCUREMENT_DRY_RUN = "true";
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.JIRA_BASE_URL;
    const r = resolveIntegrationDryRun({
      jiraProjectKey: "WH",
      slackChannelId: "C123",
    });
    assert.equal(r.dryRun, true);
    assert.equal(r.reason, "env");
  });

  it("auto dry-runs only when both live integrations are missing", () => {
    process.env.PROCUREMENT_DRY_RUN = "false";
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    const r = resolveIntegrationDryRun({
      jiraProjectKey: "",
      slackChannelId: "",
    });
    assert.equal(r.dryRun, true);
    assert.equal(r.reason, "auto_missing_config");
  });

  it("does not auto dry-run when Slack is live-ready but Jira is not", () => {
    process.env.PROCUREMENT_DRY_RUN = "false";
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    process.env.SLACK_CHANNEL_ID = "C123";
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    const r = resolveIntegrationDryRun({
      jiraProjectKey: "",
      slackChannelId: "C123",
      slackPingUserId: "U1",
    });
    assert.equal(r.dryRun, false);
    assert.equal(r.reason, "live_partial_config");
    assert.ok(r.missingLive.includes("JIRA_BASE_URL"));
  });
});

describe("slack-client dryRun override", () => {
  before(() => {
    process.env.PROCUREMENT_DRY_RUN = "true";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_CHANNEL_ID = "C123";
  });

  it("explicit dryRun:false wins over env so live probe / post can run", () => {
    const cfg = getSlackConfig({ dryRun: false, channelId: "C123" });
    assert.equal(cfg.dryRun, false);
  });

  it("postSlackMessage with dryRun:false attempts Slack HTTP (fails auth, not silent dry-run)", async () => {
    process.env.PROCUREMENT_DRY_RUN = "false";
    process.env.SLACK_BOT_TOKEN = "xoxb-invalid-for-test";
    await assert.rejects(
      () =>
        postSlackMessage({
          channelId: "C123",
          text: "probe",
          dryRun: false,
        }),
      /Slack chat\.postMessage failed/,
    );
  });
});
