import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

const savedEnv = {
  JIRA_BASE_URL: process.env.JIRA_BASE_URL,
  JIRA_EMAIL: process.env.JIRA_EMAIL,
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
  PROCUREMENT_DRY_RUN: process.env.PROCUREMENT_DRY_RUN,
};
const originalFetch = globalThis.fetch;
process.env.JIRA_BASE_URL = "https://jira.example.test";
process.env.JIRA_EMAIL = "bot@example.test";
process.env.JIRA_API_TOKEN = "test-token";
process.env.PROCUREMENT_DRY_RUN = "false";

const { createJiraIssue } = await import("./jira-client.js");

before(() => { process.env.PROCUREMENT_DRY_RUN = "false"; });
after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Jira named required create fields", () => {
  it("maps display names and allowed option labels to Jira field and option IDs", async () => {
    let createPayload;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("/issuetypes?") && options.method === "GET") {
        return Response.json({ values: [{ id: "10001", name: "Task" }] });
      }
      if (target.endsWith("/issuetypes/10001?maxResults=100")) {
        return Response.json({ fields: {
          customfield_10101: { name: "Service & Issues", schema: { type: "option" }, allowedValues: [{ id: "201", value: "Catalog / Stock Issue" }] },
          customfield_10102: { name: "GEO", schema: { type: "option" }, allowedValues: [{ id: "202", value: "US" }] },
          customfield_10103: { name: "Customer", schema: { type: "option" }, allowedValues: [{ id: "203", value: "Firstbase" }] },
        } });
      }
      if (target.endsWith("/rest/api/3/issue") && options.method === "POST") {
        createPayload = JSON.parse(options.body);
        return Response.json({ key: "WH-42", id: "42", self: "https://jira.example.test/rest/api/3/issue/42" }, { status: 201 });
      }
      throw new Error(`Unexpected Jira request: ${options.method} ${target}`);
    };

    const issue = await createJiraIssue({
      projectKey: "WH",
      issueType: "Task",
      summary: "[TEST] probe",
      description: "Probe description",
      dryRun: false,
    });

    assert.equal(issue.key, "WH-42");
    assert.deepEqual(
      Object.fromEntries(Object.entries(createPayload.fields).filter(([key]) => key.startsWith("customfield_"))),
      {
        customfield_10101: { id: "201" },
        customfield_10102: { id: "202" },
        customfield_10103: { id: "203" },
      },
    );
  });

  it("reports Jira's available choices when a configured value is absent", async () => {
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("/issuetypes?") && options.method === "GET") return Response.json({ values: [{ id: "10001", name: "Task" }] });
      if (target.endsWith("/issuetypes/10001?maxResults=100")) {
        return Response.json({ fields: {
          customfield_10100: { name: "Service & Issues", schema: { type: "option" }, allowedValues: [{ id: "200", value: "Catalog / Stock Issue" }] },
          customfield_10101: { name: "GEO", schema: { type: "option" }, allowedValues: [{ id: "1", value: "CA" }, { id: "2", value: "US" }] },
          customfield_10102: { name: "Customer", schema: { type: "option" }, allowedValues: [{ id: "203", value: "Firstbase" }] },
        } });
      }
      throw new Error(`Unexpected Jira request: ${options.method} ${target}`);
    };
    await assert.rejects(
      () => createJiraIssue({ projectKey: "WH", issueType: "Task", summary: "probe", description: "", requiredFields: { GEO: "Mars" }, dryRun: false }),
      /Jira field "GEO" has no option "Mars"\. Available options: CA, US/,
    );
  });
});
