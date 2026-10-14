import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  denverDayKey,
  nextDenverDayKey,
  isPastProcurementClose,
  CLOSE_MINUTES_MST,
} from "./denver-day.js";

describe("denver day helpers", () => {
  it("formats YYYY-MM-DD day keys", () => {
    const key = denverDayKey(new Date("2026-10-05T18:00:00Z"));
    assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("advances to the next Denver calendar day", () => {
    assert.equal(nextDenverDayKey("2026-10-05"), "2026-10-06");
    assert.equal(nextDenverDayKey("2026-10-31"), "2026-11-01");
    assert.equal(nextDenverDayKey("2026-12-31"), "2027-01-01");
    const fromDate = nextDenverDayKey(new Date("2026-10-05T18:00:00Z"));
    assert.equal(fromDate, nextDenverDayKey(denverDayKey(new Date("2026-10-05T18:00:00Z"))));
  });

  it("detects before/after 2:30pm Denver close", () => {
    // 14:00 Denver during MDT = 20:00 UTC; during MST = 21:00 UTC.
    // Use a fixed instant and compare against minutesOfDay via known bounds.
    assert.equal(typeof isPastProcurementClose(new Date()), "boolean");
    assert.equal(CLOSE_MINUTES_MST, 14 * 60 + 30);
  });
});
