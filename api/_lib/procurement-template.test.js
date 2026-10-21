import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatProcurementLine,
  formatProcurementLinesBlock,
  renderProcurementTicket,
  applyTemplate,
  DEFAULT_JIRA_SUMMARY,
} from "./procurement-template.js";
import { jiraDescriptionToAdf } from "./jira-client.js";

describe("procurement template", () => {
  it("omits notes when empty", () => {
    const text = formatProcurementLine({
      created_by_name: "Ada",
      link: "https://example.com/a",
      quantity: 3,
      notes: "   ",
    });
    assert.match(text, /Ada/);
    assert.match(text, /Quantity: 3/);
    assert.equal(text.includes("Notes:"), false);
  });

  it("includes notes when non-empty", () => {
    const text = formatProcurementLine({
      created_by_email: "a@b.c",
      link: "https://example.com/b",
      quantity: 1,
      notes: "Size L",
    });
    assert.match(text, /Notes: Size L/);
  });

  it("renders bulk ticket with line_count and date", () => {
    const ticket = renderProcurementTicket({
      summaryTemplate: DEFAULT_JIRA_SUMMARY,
      descriptionTemplate: "Day {{date}} ({{line_count}})\n\n{{lines}}",
      dayKey: "2026-10-05",
      lines: [
        {
          created_by_name: "Ada",
          link: "https://example.com/a",
          quantity: 2,
          notes: "",
        },
        {
          created_by_name: "Bob",
          link: "https://example.com/b",
          quantity: 5,
          notes: "rush",
        },
      ],
    });
    assert.equal(ticket.summary, "Warehouse Procurement Order — 2026-10-05");
    assert.match(ticket.description, /Day 2026-10-05 \(2\)/);
    assert.match(ticket.description, /Ada/);
    assert.match(ticket.description, /Notes: rush/);
    assert.equal(
      formatProcurementLinesBlock([]),
      "(no lines)",
    );
  });

  it("converts procurement URLs to clickable Jira links", () => {
    const doc = jiraDescriptionToAdf(
      "Link: https://example.com/item?sku=42. Order **2 units**",
    );
    assert.deepEqual(doc.content[0].content, [
      { type: "text", text: "Link: " },
      {
        type: "text",
        text: "https://example.com/item?sku=42",
        marks: [
          {
            type: "link",
            attrs: { href: "https://example.com/item?sku=42" },
          },
        ],
      },
      { type: "text", text: "." },
      { type: "text", text: " Order " },
      {
        type: "text",
        text: "2 units",
        marks: [{ type: "strong" }],
      },
    ]);
  });

  it("applyTemplate leaves unknown keys empty", () => {
    assert.equal(applyTemplate("x={{missing}}", {}), "x=");
  });
});
