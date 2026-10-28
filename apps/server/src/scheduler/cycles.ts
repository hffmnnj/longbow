import type { CycleKind } from "@rh/shared";
import type {
  AgentControl,
  Clock,
  EventBus,
  Logger,
  MarketCalendar,
  Store,
} from "../ports.ts";

export interface CyclePoint {
  at: number;
  kind: CycleKind;
}

export interface SchedulerDeps {
  agent: Pick<AgentControl, "runCycle">;
  calendar: MarketCalendar;
  store: Pick<Store, "getSettings">;
  bus: EventBus;
  clock: Clock;
  log: Logger;
  /** Keeps the agent's status fresh; wired by main.ts. */
  onNext?: (next: CyclePoint | undefined) => void;
}

const TZ = "America/New_York";

interface EtParts {
  date: string;
  minutes: number;
}

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function etParts(now: number): EtParts {
  const parts = partsFormat.formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** Convert an ET wall time to epoch ms via fixed-point iteration on the zone offset. */
export function etToMs(date: string, minutes: number): number {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const target = Date.parse(`${date}T${hh}:${mm}:00Z`);
  let guess = target - 5 * 3600_000;
  for (let i = 0; i < 3; i++) {
    const asEt = etParts(guess);
    const asEtMs = Date.parse(
      `${asEt.date}T${String(Math.floor(asEt.minutes / 60)).padStart(2, "0")}:${String(asEt.minutes % 60).padStart(2, "0")}:00Z`,
    );
    guess += target - asEtMs;
  }
  return guess;
}

function alignUp(now: number, intervalMs: number): number {
  return Math.floor(now / intervalMs) * intervalMs + intervalMs;
}

const PRE_OPEN_MIN = 9 * 60;
const INTRADAY_FIRST_MIN = 9 * 60 + 45;
const INTRADAY_LAST_MIN = 15 * 60 + 45;

/**
 * The next cycle after `now`, all in America/New_York. On a trading day the
 * day schedule wins while any of it is still ahead (pre-open 09:00, intraday
 * every cycleMinutesOpen from 09:45, post-close 16:10 or 13:10 on early-close
 * days); before 09:00 ET an overnight cycle aligned to cycleMinutesClosed
 * still fires when it falls earlier than pre-open (pre-open wins an exact
 * tie); at all other times an overnight cycle aligned to cycleMinutesClosed.
 */
export function nextCycle(now: number, calendar: MarketCalendar, settings: { cycleMinutesOpen: number; cycleMinutesClosed: number }): CyclePoint {
  const closedMs = Math.max(30, Math.floor(settings.cycleMinutesClosed)) * 60_000;
  const overnight: CyclePoint = { at: alignUp(now, closedMs), kind: "overnight" };
  const today = etParts(now).date;
  // Probe midday to learn whether `today` trades and whether it closes early.
  const probe = calendar.clock(etToMs(today, 12 * 60));
  if (probe.tradingDay === today) {
    const closeMin = probe.earlyClose ? 13 * 60 : 16 * 60;
    const postMin = closeMin + 10;
    const intradayLast = Math.min(INTRADAY_LAST_MIN, closeMin - 15);
    const at = (minutes: number): number => etToMs(today, minutes);
    if (now < at(PRE_OPEN_MIN)) {
      if (overnight.at < at(PRE_OPEN_MIN)) return overnight;
      return { at: at(PRE_OPEN_MIN), kind: "pre_open" };
    }
    const step = Math.max(5, Math.floor(settings.cycleMinutesOpen));
    for (let m = INTRADAY_FIRST_MIN; m <= intradayLast; m += step) {
      if (now < at(m)) return { at: at(m), kind: "intraday" };
    }
    if (now < at(postMin)) return { at: at(postMin), kind: "post_close" };
  }
  return overnight;
}

/**
 * Single-setTimeout loop to the next cycle, re-armed after each run and
 * whenever settings may have changed. Never drifts (each arm recomputes from
 * the clock) and never double-fires (one timer at a time, guarded by a
 * generation counter).
 */
export function startScheduler(deps: SchedulerDeps): { stop(): void; next(): CyclePoint } {
  const { agent, calendar, store, bus, clock, log, onNext } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let stopped = false;
  let current: CyclePoint = computeNext();

  function computeNext(): CyclePoint {
    try {
      const settings = store.getSettings();
      return nextCycle(clock.now(), calendar, settings);
    } catch (error) {
      // A settings read failure must not kill the loop; retry on the closed cadence.
      log.warn("scheduler settings read failed, retrying overnight", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return { at: alignUp(clock.now(), 4 * 3600_000), kind: "overnight" };
    }
  }

  function arm(): void {
    if (stopped) return;
    generation += 1;
    const gen = generation;
    if (timer !== undefined) clearTimeout(timer);
    current = computeNext();
    onNext?.(current);
    const delay = Math.max(0, current.at - clock.now());
    timer = setTimeout(() => {
      if (stopped || gen !== generation) return;
      const kind = current.kind;
      // Re-arm before running so a slow cycle cannot shift the next one.
      arm();
      agent.runCycle(kind).catch((error: unknown) => {
        log.warn("scheduled cycle failed", { kind, error: error instanceof Error ? error.message : "unknown" });
      });
    }, delay);
    timer.unref?.();
  }

  const offBus = bus.subscribe((event) => {
    // Settings PATCHes publish a status event; re-arm so a new cadence applies now.
    if (event.type === "status") arm();
  });

  arm();
  log.info("scheduler started", { at: current.at, kind: current.kind });

  return {
    stop(): void {
      stopped = true;
      generation += 1;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      offBus();
    },
    next(): CyclePoint {
      current = computeNext();
      return current;
    },
  };
}
