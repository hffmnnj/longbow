import type { ChatMessage, ServerEvent, SubagentRun, ToolCallSummary } from "@rh/shared";
import { ROLE_TEXT, mockRun } from "./data.ts";

export interface WorkHost {
  emit(event: ServerEvent): void;
  addMessage(m: Omit<ChatMessage, "id" | "at">): ChatMessage;
  setRunning(running: boolean): void;
  /** Streams the lead agent's final reply. */
  reply(): void;
  runs: Map<string, SubagentRun>;
  transcripts: Map<string, ChatMessage[]>;
}

const CODE = `// Look at the setup from three angles before sizing anything.
const [msft, qqq] = await Promise.all([
  tools.market_indicators({ symbol: "MSFT" }),
  tools.market_indicators({ symbol: "QQQ" }),
]);

const news = await tools.web_search({ query: "MSFT guidance Azure growth" });

const [bull, bear, risk] = await Promise.all(
  ["bull", "bear", "risk_reviewer"].map((role) =>
    tools.delegate({ role, symbol: "MSFT", task: "Review the MSFT setup." }),
  ),
);

return { rsi14: msft.rsi14, aboveSma20: msft.close > msft.sma20, news: news.length };`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A scripted Code Mode step: calls resolve one by one, then three subagents stream in parallel.
 * `hold` leaves the agents mid-stream so screenshots can capture the running state.
 */
export async function runWork(host: WorkHost, opts: { pace?: number; hold?: boolean } = {}): Promise<void> {
  const pace = opts.pace ?? 1;
  const t = (ms: number) => wait(ms * pace);
  host.setRunning(true);
  host.addMessage({
    role: "cycle",
    text: `Cycle intraday-${new Date().toISOString().slice(0, 16)} (intraday).\nRegular session, entry window open.`,
  });
  await t(500);
  const start = Date.now();
  host.addMessage({ role: "tool", toolName: "codemode", text: "", code: CODE });

  const calls: ToolCallSummary[] = [];
  const push = () => host.emit({ type: "calls", calls: calls.map((c) => ({ ...c })) });
  const begin = (name: string, args: object): ToolCallSummary => {
    const c: ToolCallSummary = { name, summary: JSON.stringify(args) };
    calls.push(c);
    push();
    return c;
  };
  const finish = (c: ToolCallSummary, durationMs: number, isError = false) => {
    c.durationMs = durationMs;
    if (isError) c.isError = true;
    push();
  };

  await t(600);
  const i1 = begin("market_indicators", { symbol: "MSFT" });
  const i2 = begin("market_indicators", { symbol: "QQQ" });
  await t(900);
  finish(i1, 412);
  await t(300);
  finish(i2, 388);
  const web = begin("web_search", { query: "MSFT guidance Azure growth" });
  await t(1200);
  finish(web, 1184);

  const roles = ["bull", "bear", "risk_reviewer"] as const;
  const dcalls = roles.map((role) => begin("delegate", { role, symbol: "MSFT" }));
  const ids = roles.map((role) => `sub-${role}-${start}`);
  roles.forEach((role, i) => {
    const run = mockRun(ids[i]!, role, Date.now() + i * 40, false);
    host.runs.set(run.id, run);
    host.transcripts.set(run.id, []);
    host.emit({ type: "subagent", run });
    const msg: ChatMessage = {
      id: `sm-${run.id}-1`,
      at: Date.now(),
      role: "tool",
      toolName: "market_indicators",
      text: "MSFT rsi14 61.2, close above sma20 and sma50",
    };
    host.transcripts.get(run.id)!.push(msg);
    host.emit({ type: "message", message: msg, conversationId: run.id });
  });
  await t(500);

  // Stream the three answers in parallel, at different speeds.
  const streams = roles.map(async (role, i) => {
    const words = (ROLE_TEXT[role] ?? "").split(/(?<=\s)/);
    const stop = opts.hold ? Math.floor(words.length * (0.45 + i * 0.12)) : words.length;
    for (let w = 0; w < stop; w++) {
      host.emit({ type: "delta", text: words[w]!, conversationId: ids[i]! });
      await wait((70 + i * 25) * pace);
    }
    if (opts.hold) return;
    const final: ChatMessage = {
      id: `sm-${ids[i]}-2`,
      at: Date.now(),
      role: "assistant",
      text: ROLE_TEXT[role] ?? "",
    };
    host.transcripts.get(ids[i]!)!.push(final);
    host.emit({ type: "message", message: final, conversationId: ids[i]! });
    const run = { ...host.runs.get(ids[i]!)!, status: "done" as const, endedAt: Date.now(), answer: final.text };
    host.runs.set(run.id, run);
    host.emit({ type: "subagent", run });
    finish(dcalls[i]!, Date.now() - start - 3000);
  });
  await Promise.all(streams);
  if (opts.hold) return;

  await t(400);
  const finalCalls = calls.map((c) => ({ ...c }));
  host.addMessage({
    role: "tool",
    toolName: "codemode",
    text: '{ "rsi14": 61.2, "aboveSma20": true, "news": 6 }',
    calls: finalCalls,
  });
  await t(500);
  host.reply();
}
