export type Section = "feed" | "portfolio" | "markets" | "performance" | "agent" | "history" | "reports" | "lab";
export const SECTIONS: readonly Section[] = ["feed", "portfolio", "markets", "performance", "agent", "history", "reports", "lab"];

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
  /** Report open in the detail view; null shows the reports list. */
  report: null as string | null,
  /** Order open in the detail sheet. */
  order: null as string | null,
  /** Run open in the lab. */
  run: null as string | null,
  /** Runs ticked for comparison. */
  compare: [] as string[],
  comparing: false,
  newSim: false,
  /** Lab tab: the run list or the variant suites. */
  labTab: "runs" as "runs" | "suites",
  /** Suite open in the detail pane; null shows the suite list. */
  suite: null as string | null,
  newSuite: false,
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

/** Opens a report in the reports section, from the list, a toast, or a deep link. */
export const openReport = (id: string) => {
  ui.section = "reports";
  ui.report = id;
};
