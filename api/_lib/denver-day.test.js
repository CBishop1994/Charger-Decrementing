import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  denverDayKey,
  nextDenverDayKey,
  isPastProcurementClose,
  previousDenverDayKey,
  denverWeekday,
  isDenverWallClockWindow,
  procurementCloseDayKeyForCron,
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

  it("handles Denver wall-clock schedules across DST and weekday rollover", () => {
    // Vercel triggers use both UTC offsets to preserve Denver wall-clock time.
    // The fixed 8:00 AM and midnight windows are validated below.
    assert.equal(isPastProcurementClose(new Date("2026-10-05T23:00:00Z")), false);
    const winterFridayEight = new Date("2026-01-09T15:30:00Z");
    const summerFridayEight = new Date("2026-07-10T14:30:00Z");
    assert.equal(denverWeekday(winterFridayEight), 5);
    assert.equal(isDenverWallClockWindow(winterFridayEight, 5, 8), true);
    assert.equal(isDenverWallClockWindow(summerFridayEight, 5, 8), true);
    assert.equal(
      isDenverWallClockWindow(new Date("2026-07-10T15:30:00Z"), 5, 8),
      false,
    );

    const winterTuesdayMidnight = new Date("2026-01-06T07:30:00Z");
    const summerTuesdayMidnight = new Date("2026-07-07T06:30:00Z");
    assert.equal(procurementCloseDayKeyForCron(winterTuesdayMidnight), "2026-01-05");
    assert.equal(procurementCloseDayKeyForCron(summerTuesdayMidnight), "2026-07-06");
    assert.equal(previousDenverDayKey(summerTuesdayMidnight), "2026-07-06");
    assert.equal(procurementCloseDayKeyForCron(new Date("2026-07-07T07:30:00Z")), null);
    assert.equal(procurementCloseDayKeyForCron(new Date("2026-07-06T06:30:00Z")), null);
  });
});
