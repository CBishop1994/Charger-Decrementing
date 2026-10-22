/**
 * America/Denver day keys and close-window helpers for warehouse procurement.
 * Daily close runs at midnight after each weekday in America/Denver.
 */

export const PROCUREMENT_TZ = "America/Denver";
/** 2:30pm MST as minutes from midnight (14*60+30). */
export const CLOSE_MINUTES_MST = 0;

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
 * Kept for compatibility; the current Denver calendar day remains open until the next midnight.
 * (Close schedule is defined as 2:30pm MST / 21:30 UTC.)
 * @param {Date} [date]
 */
export function denverWeekday(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: PROCUREMENT_TZ,
    weekday: "short",
  }).format(date);
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[weekday] ?? 0;
}

/** Previous calendar day key in America/Denver. @param {Date | string} [dateOrDayKey] */
export function previousDenverDayKey(dateOrDayKey = new Date()) {
  const dayKey =
    typeof dateOrDayKey === "string"
      ? String(dateOrDayKey).trim()
      : denverDayKey(dateOrDayKey);
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid Denver day key: ${dayKey}`);
  }
  const localNoonUtc = Date.UTC(year, month - 1, day, 18, 0, 0);
  return denverDayKey(new Date(localNoonUtc - 24 * 60 * 60 * 1000));
}

/** True anywhere within the selected Denver wall-clock hour. */
export function isDenverWallClockWindow(date, weekday, hour) {
  return denverWeekday(date) === weekday && denverClockParts(date).hour === hour;
}

/**
 * Return the weekday to close when a scheduled trigger lands during midnight
 * after Monday-Friday; null means this is outside the scheduled window.
 */
export function procurementCloseDayKeyForCron(date = new Date()) {
  const weekday = denverWeekday(date);
  if (denverClockParts(date).hour !== 0 || weekday < 2 || weekday > 6) {
    return null;
  }
  return previousDenverDayKey(date);
}

export function isPastProcurementClose(date = new Date()) {
  return false;
}

/**
 * Human label for the weekday midnight close schedule.
 */
export function procurementCloseScheduleLabel() {
  return "12:00am after weekdays (America/Denver via Vercel Cron)";
}
