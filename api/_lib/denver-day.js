/**
 * America/Denver day keys and close-window helpers for warehouse procurement.
 * Daily close is 2:30pm Mountain Standard Time (UTC−7) = 21:30 UTC.
 */

export const PROCUREMENT_TZ = "America/Denver";
/** 2:30pm MST as minutes from midnight (14*60+30). */
export const CLOSE_MINUTES_MST = 14 * 60 + 30;

/**
 * @param {Date} [date]
 * @returns {string} YYYY-MM-DD in America/Denver
 */
export function denverDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROCUREMENT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Next calendar day key in America/Denver (not business-day aware).
 * @param {Date | string} [dateOrDayKey] Date instant, or YYYY-MM-DD Denver key
 * @returns {string} YYYY-MM-DD
 */
export function nextDenverDayKey(dateOrDayKey = new Date()) {
  const dayKey =
    typeof dateOrDayKey === "string"
      ? String(dateOrDayKey).trim()
      : denverDayKey(dateOrDayKey);
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(`Invalid Denver day key: ${dayKey}`);
  }
  // 18:00 UTC on the calendar Y-M-D is always the same Denver calendar day
  // (MST/MDT), so +24h advances the Denver day key by one.
  const base = Date.UTC(y, m - 1, d, 18, 0, 0);
  return denverDayKey(new Date(base + 24 * 60 * 60 * 1000));
}

/**
 * Local clock parts in America/Denver.
 * @param {Date} [date]
 */
export function denverClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PROCUREMENT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute, minutesOfDay: hour * 60 + minute };
}

/**
 * True when America/Denver local time is at or past 2:30pm.
 * (Close schedule is defined as 2:30pm MST / 21:30 UTC.)
 * @param {Date} [date]
 */
export function isPastProcurementClose(date = new Date()) {
  return denverClockParts(date).minutesOfDay >= CLOSE_MINUTES_MST;
}

/**
 * Human label for the next scheduled close (Vercel cron: 30 21 * * * UTC).
 */
export function procurementCloseScheduleLabel() {
  return "2:30pm MST (21:30 UTC daily via Vercel Cron)";
}
