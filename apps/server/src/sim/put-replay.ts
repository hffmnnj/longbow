import { z } from "zod";
import { createNyseCalendar, NYSE_HOLIDAY_COVERAGE } from "../risk/calendar.ts";
import { paperSettlementDate } from "./settlement.ts";

const cents = z.number().int().min(0).max(1_000_000_000);
const positiveCents = cents.min(1);
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/);
const time = z.string().max(24).regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/).transform((text, ctx) => {
  const parsed = Date.parse(text);
  const normal = text.includes(".") ? text : text.replace(/Z$/, ".000Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normal) {
    ctx.addIssue({ code: "custom", message: "Invalid UTC timestamp" });
    return z.NEVER;
  }
  return parsed;
});
const inputSchema = z.strictObject({
  startingCashCents: positiveCents,
  maxPremiumAtRiskCents: positiveCents,
  feePerContractCents: cents.max(10_000),
  contracts: z.array(z.strictObject({
    id, underlying: z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/), strikeCents: positiveCents,
    expiresAt: time, multiplier: z.literal(100),
  })).min(1).max(100),
  quotes: z.array(z.strictObject({
    at: time, contractId: id, bidCents: cents, askCents: positiveCents,
    bidSize: z.number().int().min(0).max(100_000), askSize: z.number().int().min(0).max(100_000),
  })).min(1).max(50_000),
  orders: z.array(z.strictObject({
    at: time, contractId: id, side: z.enum(["buy", "sell"]),
    quantity: z.number().int().min(1).max(100), limitCents: positiveCents,
  })).min(1).max(2_000),
});
type Order = z.output<typeof inputSchema>["orders"][number];
type Lot = { quantity: number; paidPerContract: number };
type Outcome = "filled" | "unfilled" | "insufficient-cash" | "premium-cap" | "insufficient-contracts";
const iso = (time: number) => new Date(time).toISOString();

/** Score pre-generated long-put intents; no pricing, live broker, or exercise fallback. */
export function replayLongPuts(data: unknown) {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    throw new Error(`Invalid replay input at ${first.path.join(".") || "root"}: ${first.message}`);
  }
  const input = parsed.data;
  if (input.maxPremiumAtRiskCents > input.startingCashCents) throw new Error("Premium cap exceeds initial cash");
  const contracts = new Map(input.contracts.map((contract) => [contract.id, contract]));
  if (contracts.size !== input.contracts.length) throw new Error("Duplicate contract ID");
  const calendar = createNyseCalendar();
  const sessions = new Map<string, ReturnType<typeof calendar.clock>>();
  const settlementDays = new Map<string, string>();
  function session(at: number) {
    const date = calendar.etDate(at);
    const cached = sessions.get(date);
    if (cached !== undefined) return cached;
    // Noon local is in the session even on NYSE early closes.
    const value = calendar.clock(Date.parse(`${date}T17:00:00Z`));
    sessions.set(date, value);
    return value;
  }
  function validateEvent(event: { at: number; contractId: string }) {
    const contract = contracts.get(event.contractId);
    if (!contract || event.at >= contract.expiresAt) throw new Error("Event refers to an unknown or expired contract");
    const bounds = session(event.at);
    const day = calendar.etDate(event.at);
    if (day < "2024-05-28" || day >= NYSE_HOLIDAY_COVERAGE.last ||
        bounds.tradingDay !== day || event.at < bounds.nextOpen || event.at >= bounds.nextClose) {
      throw new Error("Put replay events must be inside NYSE regular hours");
    }
    return bounds.nextClose;
  }
  const quoteKeys = new Set<string>();
  for (const quote of input.quotes) {
    validateEvent(quote);
    const key = `${quote.contractId}/${quote.at}`;
    if (quoteKeys.has(key) || quote.bidCents > quote.askCents) throw new Error("Duplicate or crossed option quote");
    quoteKeys.add(key);
  }
  const orders = input.orders.map((order, index) => ({ ...order, index, sessionClose: validateEvent(order) }));
  const events = [
    ...orders.map((order) => ({ kind: "order" as const, at: order.at, order })),
    ...input.quotes.map((quote) => ({ kind: "quote" as const, at: quote.at, quote })),
  ].sort((a, b) => a.at - b.at);
  let settled = input.startingCashCents;
  let pendingProceeds = 0;
  const receivables: { day: string; cents: number }[] = [];
  let lastDay = "";
  let openPremium = 0;
  let peakPremium = 0;
  let fees = 0;
  const holdings = new Map<string, Lot[]>();
  const openOrders = new Map<string, typeof orders>();
  const outcomes: Outcome[] = orders.map(() => "unfilled");
  const fills: (Omit<Order, "at"> & { orderIndex: number; at: string; priceCents: number; feeCents: number })[] = [];
  for (const event of events) {
    const day = calendar.etDate(event.at);
    if (day !== lastDay) {
      while (receivables[0] && receivables[0].day <= day) {
        const payout = receivables.shift()!.cents;
        pendingProceeds -= payout;
        settled += payout;
      }
      lastDay = day;
    }
    if (event.kind === "order") {
      const pending = openOrders.get(event.order.contractId) ?? [];
      pending.push(event.order);
      openOrders.set(event.order.contractId, pending);
      continue;
    }
    const { quote } = event;
    const waiting = openOrders.get(quote.contractId);
    if (!waiting?.length) continue;
    let availableBid = quote.bidSize, availableAsk = quote.askSize;
    const later: typeof orders = [];
    for (const order of waiting) {
      if (quote.at > order.at + 60_000 || quote.at >= order.sessionClose) continue;
      if (quote.at <= order.at) { later.push(order); continue; }
      const buy = order.side === "buy";
      const price = buy ? quote.askCents : quote.bidCents;
      if (price <= 0 || (buy ? price > order.limitCents || availableAsk < order.quantity
        : price < order.limitCents || availableBid < order.quantity)) { later.push(order); continue; }
      const lots = holdings.get(order.contractId) ?? [];
      const fee = input.feePerContractCents * order.quantity;
      const premium = price * 100 * order.quantity;
      if (buy) {
        if (settled < premium + fee) { outcomes[order.index] = "insufficient-cash"; continue; }
        if (openPremium + premium + fee > input.maxPremiumAtRiskCents) { outcomes[order.index] = "premium-cap"; continue; }
        const paidPerContract = price * 100 + input.feePerContractCents;
        lots.push({ quantity: order.quantity, paidPerContract });
        holdings.set(order.contractId, lots);
        openPremium += premium + fee;
        peakPremium = Math.max(peakPremium, openPremium);
        settled -= premium + fee;
        availableAsk -= order.quantity;
      } else {
        if (lots.reduce((sum, lot) => sum + lot.quantity, 0) < order.quantity) {
          outcomes[order.index] = "insufficient-contracts";
          continue;
        }
        const proceeds = premium - fee;
        if (settled + Math.min(0, proceeds) < 0) { outcomes[order.index] = "insufficient-cash"; continue; }
        let quantity = order.quantity;
        while (quantity > 0) {
          const lot = lots[0]!;
          const sold = Math.min(quantity, lot.quantity);
          quantity -= sold;
          lot.quantity -= sold;
          openPremium -= sold * lot.paidPerContract;
          if (lot.quantity === 0) lots.shift();
        }
        if (!lots.length) holdings.delete(order.contractId);
        if (proceeds > 0) {
          let settlesOn = settlementDays.get(day);
          if (!settlesOn) {
            settlesOn = paperSettlementDate(day, calendar, false);
            settlementDays.set(day, settlesOn);
          }
          receivables.push({ day: settlesOn, cents: proceeds });
          pendingProceeds += proceeds;
        } else settled += proceeds;
        availableBid -= order.quantity;
      }
      fees += fee;
      outcomes[order.index] = "filled";
      fills.push({ orderIndex: order.index, at: iso(quote.at), side: order.side, quantity: order.quantity,
        limitCents: order.limitCents, contractId: order.contractId, priceCents: price, feeCents: fee });
    }
    openOrders.set(quote.contractId, later);
  }
  if (holdings.size) throw new Error("Unscorable replay: positions require observed closeout before the tape ends or the contract expires");
  const cash = settled + pendingProceeds;
  return { mode: "paper-long-puts" as const, startingCashCents: input.startingCashCents, endingCashCents: cash,
    endingSettledCashCents: settled, endingUnsettledProceedsCents: pendingProceeds,
    netPnlCents: cash - input.startingCashCents, peakPremiumAtRiskCents: peakPremium, feesCents: fees, fills,
    orders: orders.map(({ at, sessionClose: _close, index, ...order }) => ({ ...order, at: iso(at), outcome: outcomes[index]! })) };
}
