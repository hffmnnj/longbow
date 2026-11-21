import type { MarketCalendar } from "../ports.ts";
import { NYSE_HOLIDAY_COVERAGE } from "../risk/calendar.ts";

const T_PLUS_ONE = "2024-05-28";
const DAY_MS = 86_400_000;

/**
 * FINRA lists Columbus Day and Veterans Day as bank holidays with trading but
 * no settlement: https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-extension-holiday-schedule
 * Reserve Banks observe a Sunday holiday on Monday, but do not close the
 * preceding Friday for a Saturday holiday: https://www.federalreserve.gov/aboutthefed/k8.htm
 */
function bankOnlyHoliday(day: Date): boolean {
  const month = day.getUTCMonth();
  const date = day.getUTCDate();
  const weekday = day.getUTCDay();
  return (month === 9 && weekday === 1 && date >= 8 && date <= 14) ||
    (month === 10 && (date === 11 || (date === 12 && weekday === 1)));
}

/**
 * Date-level paper model, not a prediction of a broker's intraday cash release.
 * Historical holidays are modeled only for covered NYSE years; otherwise use weekdays.
 */
export function paperSettlementDate(tradeDate: string, calendar: MarketCalendar, fictional: boolean): string {
  // Blind and bootstrap dates are fictional; do not infer a real clearing holiday from them.
  // SEC T+1 compliance date: https://www.sec.gov/newsroom/press-releases/2024-62
  let remaining = !fictional && tradeDate < T_PLUS_ONE ? 2 : 1;
  const tradeDay = Date.parse(`${tradeDate}T12:00:00Z`);
  if (!Number.isFinite(tradeDay)) throw new Error(`Invalid paper trade date ${tradeDate}`);
  for (let offset = 1; offset <= 14; offset++) {
    const at = tradeDay + offset * DAY_MS;
    const day = new Date(at);
    const date = day.toISOString().slice(0, 10);
    if (fictional) {
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    } else {
      const covered = date >= NYSE_HOLIDAY_COVERAGE.first && date <= NYSE_HOLIDAY_COVERAGE.last;
      if (covered && bankOnlyHoliday(day)) continue;
      // Unlike the exchanges, DTCC was open on the Carter day of mourning:
      // https://www.sifma.org/resources/guides-playbooks/unscheduled-close-market-matrix
      if (date !== "2025-01-09" && calendar.clock(at).tradingDay !== date) continue;
    }
    if (--remaining === 0) return date;
  }
  throw new Error(`No paper settlement date within two weeks of ${tradeDate}`);
}
