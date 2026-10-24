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
});

export const openSymbol = (symbol: string) => (ui.symbol = symbol.toUpperCase());
export const openNote = (path: string) => (ui.note = path);
export const openSkill = (name: string) => (ui.skill = name);
export const openAgent = (id: string) => (ui.agent = id);
