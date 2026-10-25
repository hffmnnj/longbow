import type { SimScenario } from "@rh/shared";

/**
 * Named regimes inside the ten years of daily history the free data sources serve (from late 2016).
 * Each window starts a few sessions before the regime turns, so the agent must notice the change itself.
 */
export const SCENARIOS: readonly SimScenario[] = [
  { id: "volmageddon-2018", name: "Volatility shock, Feb 2018", description: "A calm melt-up that breaks into a sudden volatility spike and a sharp 10% drop.", startDate: "2018-01-16", days: 35, regime: "shock" },
  { id: "q4-selloff-2018", name: "Q4 2018 selloff", description: "A grinding 20% decline into a Christmas Eve low, then a fast rebound.", startDate: "2018-09-24", days: 75, regime: "bear" },
  { id: "covid-crash-2020", name: "COVID crash, 2020", description: "Record highs into the fastest 30% crash on record, with limit-down gaps.", startDate: "2020-02-03", days: 40, regime: "crash" },
  { id: "covid-recovery-2020", name: "V-shaped recovery, 2020", description: "A relentless rally off the March low that punishes waiting for a pullback.", startDate: "2020-03-24", days: 60, regime: "bull" },
  { id: "steady-bull-2021", name: "Steady bull, 2021", description: "A low-volatility uptrend with sector rotation under the surface.", startDate: "2021-03-01", days: 60, regime: "bull" },
  { id: "rate-shock-2022", name: "Rate-shock bear, H1 2022", description: "Rising rates drive a broad bear market where growth and tech fall hardest.", startDate: "2022-01-03", days: 80, regime: "bear" },
  { id: "bear-rally-2022", name: "Bear-market rally, summer 2022", description: "A convincing 17% rally inside a bear market that fully reverses.", startDate: "2022-06-13", days: 70, regime: "chop" },
  { id: "ai-rally-2023", name: "Narrow AI rally, 2023", description: "A handful of mega-cap tech names lead while breadth stays weak.", startDate: "2023-05-01", days: 60, regime: "rotation" },
  { id: "autumn-chop-2023", name: "Autumn correction, 2023", description: "A choppy 10% correction on rising yields, ending in a sharp November reversal.", startDate: "2023-08-01", days: 75, regime: "chop" },
  { id: "carry-unwind-2024", name: "Rotation and carry unwind, 2024", description: "A violent rotation out of tech into small caps, then a one-day volatility spike.", startDate: "2024-07-08", days: 40, regime: "shock" },
  { id: "tariff-shock-2025", name: "Tariff shock, spring 2025", description: "A policy shock crashes the market in days, then a sudden pause sparks a record rally.", startDate: "2025-03-17", days: 45, regime: "crash" },
];

export function scenarioById(id: string): SimScenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
