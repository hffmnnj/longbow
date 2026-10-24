import type { MarketClock } from "@rh/shared";
import type { MarketCalendar } from "../ports.ts";

/**
 * NYSE calendar for the risk gate. Regular session 09:30-16:00 ET Monday to
 * Friday, pre-market 04:00-09:30, post-market 16:00-20:00. Times come from
 * `Intl.DateTimeFormat` in America/New_York so daylight saving is handled by
 * the platform, not by hand-rolled offsets.
 *
 * Full-closure and early-close tables cover 2026-2027. Dates after 2027 fall
 * back to weekdays only; extend the tables below for later years.
 */

const FULL_CLOSURES = new Set<string>([
  // 2026: New Year's Day, MLK Day, Presidents Day, Good Friday, Memorial Day,
  // Juneteenth, Independence Day (observed Jul 3), Labor Day, Thanksgiving, Christmas.
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  // 2027: New Year's Day, MLK Day, Presidents Day, Good Friday, Memorial Day,
  // Juneteenth (observed Jun 18), Independence Day (observed Jul 5), Labor Day,
  // Thanksgiving, Christmas (observed Dec 24).
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

/** ET dates with a 13:00 regular-session close. */
const EARLY_CLOSES = new Set<string>(["2026-11-27", "2026-12-24", "2027-11-26"]);

const PRE_OPEN_MIN = 4 * 60;
const REGULAR_OPEN_MIN = 9 * 60 + 30;
const REGULAR_CLOSE_MIN = 16 * 60;
const EARLY_CLOSE_MIN = 13 * 60;
const POST_CLOSE_END_MIN = 20 * 60;
const MS_PER_DAY = 86_400_000;

const wallFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface EtWall {
  date: string;
  minutes: number;
  weekday: number;
}

function etWall(now: number): EtWall {
  let y = 1970;
  let mo = 1;
  let d = 1;
  let h = 0;
  let mi = 0;
  let weekday = 0;
  for (const part of wallFormat.formatToParts(new Date(now))) {
    switch (part.type) {
      case "year":
        y = Number(part.value);
        break;
      case "month":
        mo = Number(part.value);
        break;
      case "day":
        d = Number(part.value);
        break;
      case "hour":
        h = Number(part.value);
        break;
      case "minute":
        mi = Number(part.value);
        break;
      case "weekday":
        weekday = WEEKDAYS.indexOf(part.value);
        break;
      default:
        break;
    }
  }
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { date, minutes: h * 60 + mi, weekday };
}

/** ET date (YYYY-MM-DD) of an instant. Shared with the engine so both agree on "today". */
export function etDateForInstant(now: number): string {
  return etWall(now).date;
}

/** Difference between Date.UTC of the NY wall time and the instant: the NY UTC offset. */
function nyOffsetMs(t: number): number {
  const w = etWall(t);
  const wholeMinutes = Math.floor(w.minutes);
  const h = Math.floor(wholeMinutes / 60);
  const mi = wholeMinutes % 60;
  const y = Number(w.date.slice(0, 4));
  const mo = Number(w.date.slice(5, 7));
  const day = Number(w.date.slice(8, 10));
  return Date.UTC(y, mo - 1, day, h, mi) - Math.floor(t / 60_000) * 60_000;
}

/** Epoch ms of an ET wall time on an ET date. Safe for 04:00-20:00 (never near a DST switch). */
function etToEpoch(etDate: string, minutes: number): number {
  const y = Number(etDate.slice(0, 4));
  const mo = Number(etDate.slice(5, 7));
  const d = Number(etDate.slice(8, 10));
  const h = Math.floor(minutes / 60);
  const mi = minutes % 60;
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = utc - nyOffsetMs(utc);
  for (let i = 0; i < 3; i++) {
    guess = utc - nyOffsetMs(guess);
  }
  return guess;
}

/** End of an ET trading day for pending-order expiry: the 20:00 close of post-market. */
export function etDayEndEpoch(etDate: string): number {
  return etToEpoch(etDate, POST_CLOSE_END_MIN);
}

function parseEtDate(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`bad ET date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function addEtDays(date: string, n: number): string {
  const { y, m, d } = parseEtDate(date);
  const t = new Date(Date.UTC(y, m - 1, d) + n * MS_PER_DAY);
  const mo = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mo}-${day}`;
}

/** Noon UTC is morning ET on the same ET date, so the UTC weekday matches the ET weekday. */
function weekdayOfEtDate(date: string): number {
  const { y, m, d } = parseEtDate(date);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function isTradingDay(date: string): boolean {
  const wd = weekdayOfEtDate(date);
  if (wd === 0 || wd === 6) return false;
  const year = Number(date.slice(0, 4));
  if (year === 2026 || year === 2027) return !FULL_CLOSURES.has(date);
  // No closure table past 2027; extend FULL_CLOSURES/EARLY_CLOSES for later years.
  return true;
}

function nextTradingDay(fromEtDate: string): string {
  let cur = addEtDays(fromEtDate, 1);
  for (let i = 0; i < 500 && !isTradingDay(cur); i++) {
    cur = addEtDays(cur, 1);
  }
  return cur;
}

export function createNyseCalendar(): MarketCalendar {
  return {
    clock(now: number): MarketClock {
      const today = etWall(now).date;
      // The relevant session: today while its post-market is still ahead,
      // otherwise the next trading day.
      let day = today;
      if (!isTradingDay(day) || now >= etToEpoch(day, POST_CLOSE_END_MIN)) {
        day = nextTradingDay(today);
      }
      const earlyClose = EARLY_CLOSES.has(day);
      const nextOpen = etToEpoch(day, REGULAR_OPEN_MIN);
      const nextClose = etToEpoch(day, earlyClose ? EARLY_CLOSE_MIN : REGULAR_CLOSE_MIN);
      let session: MarketClock["session"] = "closed";
      let isOpen = false;
      if (day === today) {
        const pre = etToEpoch(today, PRE_OPEN_MIN);
        const postEnd = etToEpoch(today, POST_CLOSE_END_MIN);
        if (now >= pre && now < nextOpen) {
          session = "pre";
        } else if (now >= nextOpen && now < nextClose) {
          session = "regular";
          isOpen = true;
        } else if (now >= nextClose && now < postEnd) {
          session = "post";
        }
      }
      return { now, session, isOpen, tradingDay: day, nextOpen, nextClose, earlyClose };
    },

    etDate(now: number): string {
      return etWall(now).date;
    },

    tradingDaysBetween(fromEtDate: string, toEtDate: string): number {
      parseEtDate(fromEtDate);
      parseEtDate(toEtDate);
      let lo = fromEtDate;
      let hi = toEtDate;
      if (hi < lo) {
        [lo, hi] = [hi, lo];
      }
      let count = 0;
      for (let cur = addEtDays(lo, 1); cur < hi; cur = addEtDays(cur, 1)) {
        if (isTradingDay(cur)) count++;
      }
      return count;
    },
  };
}
