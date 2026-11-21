import type { OrderRecord, Position } from "@rh/shared";
import { executedHarnessOrders } from "../analytics/compute.ts";

type ReviewDate = { date: string; quantity: number; state: "past" | "today" | "upcoming" };
export type RecordedEntryReview =
  | { symbol: string; status: "recorded"; dates: ReviewDate[] }
  | { symbol: string; status: "owner" | "unverified" };

const EPS = 1e-9;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+instant) && instant.toISOString().slice(0, 10) === value;
}

/** Original intent dates on locally observed lots; not current thesis notes or broker tax lots. */
export function recordedEntryReviews(
  positions: readonly Position[],
  orders: readonly OrderRecord[],
  todayEt: string,
  snapshotAt = Infinity,
): RecordedEntryReview[] {
  const executed = executedHarnessOrders(orders);
  const observedIds = new Set(executed.map((order) => order.id));
  const incomplete = new Set(orders.filter((order) => (order.filledQuantity ?? 0) > 0 &&
    (!observedIds.has(order.id) || !Number.isFinite(order.updatedAt) || order.updatedAt > snapshotAt))
    .map((order) => order.intent.symbol));
  return positions.map(({ symbol, quantity }) => {
    const unknown = { symbol, status: "unverified" } as const;
    if (incomplete.has(symbol)) return unknown;
    const legs = executed.filter((order) => order.intent.symbol === symbol);
    const buyAt = new Set(legs.filter((leg) => leg.intent.side === "buy").map((leg) => leg.updatedAt));
    if (legs.some((leg) => leg.intent.side === "sell" && buyAt.has(leg.updatedAt))) return unknown;
    const lots: { remaining: number; date: string; owner: boolean }[] = [];
    for (const leg of legs) {
      if (leg.intent.side === "buy") {
        lots.push({ remaining: leg.filledQuantity, date: leg.intent.timeStopDate, owner: leg.ownerMessageId !== undefined });
        continue;
      }
      let sold = leg.filledQuantity;
      while (sold > EPS && lots.length > 0) {
        const lot = lots[0]!;
        const used = Math.min(lot.remaining, sold);
        lot.remaining -= used;
        sold -= used;
        if (lot.remaining <= EPS) lots.shift();
      }
      if (sold > EPS) return unknown;
    }
    if (!Number.isFinite(quantity) || lots.length === 0 ||
      Math.abs(lots.reduce((sum, lot) => sum + lot.remaining, 0) - quantity) > EPS) return unknown;
    if (lots.every((lot) => lot.owner)) return { symbol, status: "owner" };
    if (lots.some((lot) => lot.owner || !validDate(lot.date))) return unknown;
    const dates = new Map<string, number>();
    for (const { date, remaining } of lots) dates.set(date, (dates.get(date) ?? 0) + remaining);
    return {
      symbol, status: "recorded",
      dates: [...dates].sort(([left], [right]) => left.localeCompare(right)).map(([date, qty]) => ({
        date, quantity: Number(qty.toFixed(8)), state: date < todayEt ? "past" : date === todayEt ? "today" : "upcoming",
      })),
    };
  });
}
