import {
  CryptoSettingsSchema,
  DEFAULT_CRYPTO,
  RiskConfigSchema,
  SettingsSchema,
  type CryptoSettings,
  type RiskConfig,
  type Settings,
  type SettingsPatch,
} from "@rh/shared";

export type RiskKey = keyof RiskConfig;

export interface FieldMeta {
  key: RiskKey;
  label: string;
  unit: string;
  step: string;
}

export const RISK_GROUPS: { title: string; fields: FieldMeta[] }[] = [
  {
    title: "Sizing",
    fields: [
      { key: "maxRiskPerTradePct", label: "Risk per trade", unit: "% equity", step: "0.1" },
      { key: "maxPositionPct", label: "Max position", unit: "% equity", step: "0.5" },
      { key: "maxSectorPct", label: "Max sector", unit: "% equity", step: "1" },
      { key: "maxPositions", label: "Max positions", unit: "count", step: "1" },
      { key: "maxOrderNotionalUsd", label: "Max order size", unit: "USD", step: "100" },
    ],
  },
  {
    title: "Loss limits",
    fields: [
      { key: "dailyLossHaltPct", label: "Daily loss halt", unit: "% equity", step: "0.1" },
      { key: "monthlyDrawdownHaltPct", label: "Monthly drawdown halt", unit: "% from peak", step: "0.5" },
      { key: "maxEntriesPerDay", label: "Entries per day", unit: "count", step: "1" },
      { key: "maxDayTrades5d", label: "Day trades, 5 days", unit: "count", step: "1" },
    ],
  },
  {
    title: "Timing",
    fields: [
      { key: "minHoldDays", label: "Min hold", unit: "days", step: "1" },
      { key: "noTradeOpenMinutes", label: "Quiet after open", unit: "min", step: "5" },
      { key: "noTradeCloseMinutes", label: "Quiet before close", unit: "min", step: "5" },
    ],
  },
  {
    title: "Execution",
    fields: [
      { key: "maxSpreadBps", label: "Max spread", unit: "bps", step: "1" },
      { key: "maxSlippageBps", label: "Max slippage", unit: "bps", step: "1" },
      { key: "minEvToCost", label: "Min EV to cost", unit: "x", step: "0.1" },
    ],
  },
];

export const RISK_KEYS: RiskKey[] = RISK_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

export interface SettingsForm {
  cycleMinutesOpen: string;
  cycleMinutesClosed: string;
  watchlist: string[];
  risk: Record<RiskKey, string>;
  crypto: {
    enabled: boolean;
    maxPortfolioPct: string;
    maxOrderNotionalUsd: string;
  };
}

export function toForm(s: Settings): SettingsForm {
  const risk = Object.fromEntries(RISK_KEYS.map((k) => [k, String(s.risk[k])])) as Record<RiskKey, string>;
  const crypto = s.crypto ?? DEFAULT_CRYPTO;
  return {
    cycleMinutesOpen: String(s.cycleMinutesOpen),
    cycleMinutesClosed: String(s.cycleMinutesClosed),
    watchlist: [...s.watchlist],
    risk,
    crypto: {
      enabled: crypto.enabled,
      maxPortfolioPct: String(crypto.maxPortfolioPct),
      maxOrderNotionalUsd: String(crypto.maxOrderNotionalUsd),
    },
  };
}

interface Checkable {
  safeParse(v: unknown): { success: boolean; error?: { issues: { code: string; message: string; minimum?: unknown; maximum?: unknown; inclusive?: boolean }[] } };
}

/** Turns a text input into a short inline error, or null when valid. */
export function fieldError(schema: Checkable, raw: string): string | null {
  if (raw.trim() === "") return "Required";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a number";
  const res = schema.safeParse(n);
  if (res.success) return null;
  const issue = res.error?.issues[0];
  if (!issue) return "Invalid value";
  if (issue.code === "too_small") {
    return issue.inclusive === false ? `Must be above ${issue.minimum}` : `Min ${issue.minimum}`;
  }
  if (issue.code === "too_big") return `Max ${issue.maximum}`;
  if (/int/i.test(issue.message)) return "Whole number";
  return issue.message;
}

export const TICKER = /^[A-Z.]{1,10}$/;

/** Errors keyed by "cycleMinutesOpen", "watchlist" or "risk.<key>". */
export function validate(form: SettingsForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const open = fieldError(SettingsSchema.shape.cycleMinutesOpen, form.cycleMinutesOpen);
  if (open) errors.cycleMinutesOpen = open;
  const closed = fieldError(SettingsSchema.shape.cycleMinutesClosed, form.cycleMinutesClosed);
  if (closed) errors.cycleMinutesClosed = closed;
  for (const k of RISK_KEYS) {
    const e = fieldError(RiskConfigSchema.shape[k], form.risk[k]);
    if (e) errors[`risk.${k}`] = e;
  }
  const pct = fieldError(CryptoSettingsSchema.shape.maxPortfolioPct, form.crypto.maxPortfolioPct);
  if (pct) errors["crypto.maxPortfolioPct"] = pct;
  const notion = fieldError(CryptoSettingsSchema.shape.maxOrderNotionalUsd, form.crypto.maxOrderNotionalUsd);
  if (notion) errors["crypto.maxOrderNotionalUsd"] = notion;
  if (form.watchlist.length > 50) errors.watchlist = "At most 50 tickers";
  return errors;
}

/** Only the fields that differ from the saved settings. */
export function buildPatch(saved: Settings, form: SettingsForm): SettingsPatch {
  const patch: SettingsPatch = {};
  if (Number(form.cycleMinutesOpen) !== saved.cycleMinutesOpen) patch.cycleMinutesOpen = Number(form.cycleMinutesOpen);
  if (Number(form.cycleMinutesClosed) !== saved.cycleMinutesClosed) patch.cycleMinutesClosed = Number(form.cycleMinutesClosed);
  if (form.watchlist.length !== saved.watchlist.length || form.watchlist.some((t, i) => t !== saved.watchlist[i])) {
    patch.watchlist = [...form.watchlist];
  }
  const risk: Partial<RiskConfig> = {};
  for (const k of RISK_KEYS) {
    const n = Number(form.risk[k]);
    if (n !== saved.risk[k]) risk[k] = n;
  }
  if (Object.keys(risk).length) patch.risk = risk;
  const savedCrypto = saved.crypto ?? DEFAULT_CRYPTO;
  const crypto: Partial<CryptoSettings> = {};
  if (form.crypto.enabled !== savedCrypto.enabled) crypto.enabled = form.crypto.enabled;
  const maxPct = Number(form.crypto.maxPortfolioPct);
  if (maxPct !== savedCrypto.maxPortfolioPct) crypto.maxPortfolioPct = maxPct;
  const maxNotional = Number(form.crypto.maxOrderNotionalUsd);
  if (maxNotional !== savedCrypto.maxOrderNotionalUsd) crypto.maxOrderNotionalUsd = maxNotional;
  if (Object.keys(crypto).length) patch.crypto = crypto;
  return patch;
}

export const isEmptyPatch = (p: SettingsPatch): boolean => Object.keys(p).length === 0;

/** Parses typed ticker text ("nvda, aapl") into valid new tickers plus rejected tokens. */
export function parseTickers(input: string, existing: readonly string[]): { added: string[]; rejected: string[] } {
  const added: string[] = [];
  const rejected: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const t = raw.trim().toUpperCase();
    if (!t) continue;
    if (!TICKER.test(t)) rejected.push(raw);
    else if (!existing.includes(t) && !added.includes(t)) added.push(t);
  }
  return { added, rejected };
}
