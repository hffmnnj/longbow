import type { SystemOneState, SystemOneStatus } from "@rh/shared";

export type SystemOneTone = "ok" | "warn" | "bad" | "muted";

const LABEL: Record<SystemOneState, string> = {
  ok: "OK",
  degraded: "Degraded",
  rate_limited: "Rate limited",
  payment: "Payment required",
  unconfigured: "Not configured",
};

const TONE: Record<SystemOneState, SystemOneTone> = {
  ok: "ok",
  degraded: "warn",
  rate_limited: "warn",
  payment: "bad",
  unconfigured: "muted",
};

/** Short status word for the chip, e.g. "Rate limited". */
export function systemOneLabel(state: SystemOneState): string {
  return LABEL[state];
}

/** Visual weight for the status dot: green, amber, red, or muted. */
export function systemOneTone(state: SystemOneState): SystemOneTone {
  return TONE[state];
}

/** "42 calls today, 150 ms median"; the median is omitted when unknown. */
export function systemOneStatsLine(s: Pick<SystemOneStatus, "calls24h" | "medianLatencyMs">): string {
  const calls = `${s.calls24h} call${s.calls24h === 1 ? "" : "s"} today`;
  return s.medianLatencyMs === undefined ? calls : `${calls}, ${s.medianLatencyMs} ms median`;
}

/**
 * Cooldown to show on the chip: only rate limits and payment holds carry one.
 * Returns undefined for every other state, even if a stale timestamp lingers.
 */
export function systemOneCooldownUntil(s: Pick<SystemOneStatus, "state" | "cooldownUntil">): number | undefined {
  return s.state === "rate_limited" || s.state === "payment" ? s.cooldownUntil : undefined;
}
