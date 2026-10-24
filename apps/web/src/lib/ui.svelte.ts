export type Section = "feed" | "portfolio" | "markets" | "performance" | "agent" | "history" | "lab";
export const SECTIONS: readonly Section[] = ["feed", "portfolio", "markets", "performance", "agent", "history", "lab"];

/** Which overlay is open. Sheets and the palette read and write this from anywhere. */
export const ui = $state({
  settings: false,
  palette: false,
  /** Symbol shown in the chart sheet. */
  symbol: null as string | null,
  /** Path of the open note, for example `theses/NVDA.md`. */
  note: null as string | null,
  /** Name of the open skill. */
  skill: null as string | null,
  /** Subagent conversation id shown in the transcript sheet. */
  agent: null as string | null,
  /** Simulation run that owns `agent`, when the transcript belongs to the lab. */
  agentSim: null as string | null,
  /** The surface on screen. Lab is the simulation workspace; the rest are the live account. */
  section: "feed" as Section,
  /** Order open in the detail sheet. */
  order: null as string | null,
  /** Run open in the lab. */
  run: null as string | null,
  /** Runs ticked for comparison. */
  compare: [] as string[],
  comparing: false,
  newSim: false,
  confirmKill: false,
});

export const openSymbol = (symbol: string) => (ui.symbol = symbol.toUpperCase());
export const openNote = (path: string) => (ui.note = path);
export const openSkill = (name: string) => (ui.skill = name);
export const openAgent = (id: string, simRunId?: string) => {
  ui.agentSim = simRunId ?? null;
  ui.agent = id;
};

export const openOrder = (id: string) => (ui.order = id);
