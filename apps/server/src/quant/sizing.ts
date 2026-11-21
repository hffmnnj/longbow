import type { RiskConfig } from "@rh/shared";

export type SizeBound = "risk" | "position" | "sector" | "notional" | "buying_power" | "none";

export type SizeCheck = {
  rule: string;
  ok: boolean;
  detail: string;
}

export type SizeResult = {
  symbol: string;
  entry: number;
  stop: number;
  quantity: number;
  notional: number;
  equityPct: number;
  riskDollars: number;
  rPerShare: number;
  boundBy: SizeBound;
  checks: SizeCheck[];
}

export type SizeInputs = {
  symbol: string;
  entry: number;
  /** Explicit stop; when absent the caller supplies an ATR-derived one. */
  stop?: number;
  atr?: number;
  atrMultiple: number;
  riskPct: number;
  equity: number;
  buyingPower: number;
  settledCash?: number;
  existingMarketValue: number;
  sectorExposure?: { name: string; marketValue: number };
  risk: RiskConfig;
}

function floorQty(qty: number): number {
  return Math.floor(qty * 1_000_000) / 1_000_000;
}

function money(v: number): string {
  return `$${v.toFixed(2)}`;
}

/**
 * Long position sizing mirroring the risk engine's entry rules. Quantity is
 * floored to 6 decimals, then capped by position and known sector exposure,
 * max order notional, effective buying power (the smaller of buying power and a
 * settled-cash mark when given), and the max risk per trade. A requested
 * riskPct above maxRiskPerTradePct is clamped and named in the check detail.
 * Pure: no network, no clock.
 */
export function computeSize(input: SizeInputs): SizeResult | { error: string } {
  const { symbol, entry, riskPct, equity, buyingPower, settledCash, existingMarketValue, sectorExposure, risk } = input;
  if (!(entry > 0)) return { error: "entry must be positive" };
  if (!(equity > 0)) return { error: "equity must be positive" };
  let stop = input.stop;
  if (stop === undefined) {
    if (input.atr === undefined || !(input.atr > 0)) {
      return { error: `no stop given for ${symbol} and no usable ATR; pass stop or wait for history` };
    }
    stop = entry - input.atrMultiple * input.atr;
  }
  if (!(stop > 0)) return { error: `stop ${stop} must be positive` };
  const rPerShare = entry - stop;
  if (!(rPerShare > 0)) return { error: `stop ${stop} is at or above entry ${entry}; longs need the stop below entry` };

  const cappedRisk = riskPct > risk.maxRiskPerTradePct;
  const effectiveRiskPct = cappedRisk ? risk.maxRiskPerTradePct : riskPct;
  const riskAllowance = (equity * effectiveRiskPct) / 100;
  const qRisk = floorQty(riskAllowance / rPerShare);
  const positionAllowance = (equity * risk.maxPositionPct) / 100;
  const qPosition = floorQty(Math.max(0, (positionAllowance - existingMarketValue) / entry));
  const sectorAllowance = equity * (risk.maxSectorPct / 100);
  const qNotional = floorQty(risk.maxOrderNotionalUsd / entry);
  const cashBound = settledCash === undefined ? buyingPower : Math.min(buyingPower, settledCash);
  const qPower = floorQty(cashBound / entry);

  const candidates: { bound: SizeBound; qty: number }[] = [
    { bound: "risk", qty: qRisk },
    { bound: "position", qty: qPosition },
    ...(sectorExposure === undefined ? [] : [{ bound: "sector" as const, qty: floorQty(Math.max(0, (sectorAllowance - sectorExposure.marketValue) / entry)) }]),
    { bound: "notional", qty: qNotional },
    { bound: "buying_power", qty: qPower },
  ];
  let boundBy: SizeBound = "none";
  let quantity = Math.min(...candidates.map((c) => c.qty));
  for (const c of candidates) {
    if (c.qty <= quantity) {
      quantity = c.qty;
      boundBy = c.bound;
      break;
    }
  }
  quantity = Math.max(0, quantity);

  const notional = quantity * entry;
  const riskDollars = quantity * rPerShare;
  const equityPct = equity === 0 ? 0 : (notional / equity) * 100;

  const checks: SizeCheck[] = [
    {
      rule: "risk_per_trade",
      ok: riskDollars <= riskAllowance,
      detail:
        `risk ${money(riskDollars)} (${quantity}x${money(rPerShare)}) vs allowance ` +
        `${money(riskAllowance)} (${effectiveRiskPct}% of equity ${money(equity)}` +
        (cappedRisk ? `; requested ${riskPct}% capped at maxRiskPerTradePct ${risk.maxRiskPerTradePct}%` : "") +
        `)`,
    },
    {
      rule: "position_size",
      ok: existingMarketValue + notional <= positionAllowance,
      detail:
        `existing ${money(existingMarketValue)} + order ${money(notional)} = ${money(existingMarketValue + notional)} ` +
        `vs ${money(positionAllowance)} (${risk.maxPositionPct}% of equity ${money(equity)})`,
    },
    ...(sectorExposure === undefined ? [] : [{
      rule: "sector",
      ok: sectorExposure.marketValue + notional <= sectorAllowance,
      detail: `${sectorExposure.name} exposure ${money(sectorExposure.marketValue)} + order ${money(notional)} ` +
        `vs ${money(sectorAllowance)} (${risk.maxSectorPct}% of equity)`,
    }]),
    {
      rule: "notional_cap",
      ok:
        notional <= risk.maxOrderNotionalUsd &&
        notional <= buyingPower &&
        (settledCash === undefined || notional <= settledCash),
      detail:
        `buy notional ${money(notional)} vs cap ${money(risk.maxOrderNotionalUsd)}, ` +
        `buying power ${money(buyingPower)}` +
        (settledCash === undefined ? " (no settled-cash mark)" : `, settled cash ${money(settledCash)}`),
    },
    {
      rule: "min_notional",
      ok: risk.minOrderNotionalUsd <= 0 || notional >= risk.minOrderNotionalUsd,
      detail:
        risk.minOrderNotionalUsd <= 0
          ? "minimum order notional is disabled ($0)"
          : `order notional ${money(notional)} vs minimum ${money(risk.minOrderNotionalUsd)}`,
    },
  ];

  return { symbol, entry, stop, quantity, notional, equityPct, riskDollars, rPerShare, boundBy, checks };
}
