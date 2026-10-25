import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ServerEvent } from "@rh/shared";
import { createEventBus } from "../events.ts";
import type { Logger } from "../ports.ts";
import { bootstrapMeanCI, createSuiteService, suiteSeed, type SuiteService } from "./suite.ts";
import { FakeRunner } from "./suite-fake.ts";
import { comparisonReading } from "./tools.ts";

const log: Logger = { info() {}, warn() {}, error() {}, child() { return this; } };

function setup() {
  const dataDir = mkdtempSync("/tmp/suite-test-");
  const bus = createEventBus();
  const seen: ServerEvent[] = [];
  bus.subscribe((event) => { seen.push(event); });
  const runner = new FakeRunner(bus);
  const suites = createSuiteService({ runner, bus, log, dataDir, now: () => 1_700_000_000_000 });
  return { dataDir, bus, runner, suites, seen,
    done() { suites.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

const variants = [{ label: "A" }, { label: "B", strategy: "Buy dips only." }];

test("suites expand variants across scenarios and bootstrap markets with shared seeds", async () => {
  const { dataDir, runner, suites, done } = setup();
  try {
    const suite = await suites.start({ name: "Momentum", scenarios: ["covid-crash-2020", "steady-bull-2021"],
      bootstrapRuns: 1, bootstrapDays: 30, startingCash: 1200, execution: "realistic", variants }, "user");
    assert.equal(suite.runs.length, 6);
    assert.equal(suite.status, "running");
    for (const scenario of ["covid-crash-2020", "steady-bull-2021"]) {
      const pair = suite.runs.filter((e) => e.scenario === scenario);
      assert.equal(pair.length, 2);
      assert.equal(pair[0]!.seed, suiteSeed(suite.id, scenario));
      assert.equal(pair[1]!.seed, suiteSeed(suite.id, scenario));
      assert.deepEqual(pair.map((e) => e.variant).sort(), ["A", "B"]);
      assert.ok(pair.every((e) => e.mode === "blind"));
    }
    const bootstraps = suite.runs.filter((e) => e.scenario === undefined);
    assert.equal(bootstraps.length, 2);
    assert.ok(bootstraps.every((e) => e.seed === 1 && e.mode === "bootstrap"));
    const names = runner.started.map((s) => s.config.name);
    assert.ok(names.includes("Momentum · A · covid-crash-2020"));
    assert.ok(names.includes("Momentum · A · bootstrap-1"));
    assert.ok(runner.started.every((s) => s.startedBy === "user" && s.options?.suiteId === suite.id));
    assert.equal(runner.started.find((s) => s.config.name === "Momentum · B · covid-crash-2020")?.config.strategy, "Buy dips only.");
    assert.equal(runner.started.find((s) => s.config.name === "Momentum · A · covid-crash-2020")?.config.strategy, undefined);
    assert.ok(runner.started.every((s) => s.config.model === "main" && s.config.startingCash === 1200));
    assert.equal(runner.started.find((s) => s.config.mode === "bootstrap")?.config.days, 30);
    assert.ok(existsSync(join(dataDir, "sim", "suites", `${suite.id}.json`)));
  } finally { done(); }
});

test("suites reject unknown scenarios, empty suites, and oversized expansions", async () => {
  const { suites, done } = setup();
  try {
    await assert.rejects(suites.start({ name: "X", scenarios: ["nope"], startingCash: 1200, variants: [{ label: "A" }] }, "user"), /Unknown scenario: nope/);
    await assert.rejects(suites.start({ name: "X", scenarios: [], bootstrapRuns: 0, startingCash: 1200, variants: [{ label: "A" }] }, "user"),
      /at least one scenario or bootstrap run/);
    const twelve = ["volmageddon-2018", "q4-selloff-2018", "covid-crash-2020", "covid-recovery-2020", "steady-bull-2021", "rate-shock-2022",
      "bear-rally-2022", "ai-rally-2023", "autumn-chop-2023", "carry-unwind-2024", "tariff-shock-2025", "q4-selloff-2018"];
    await assert.rejects(suites.start({ name: "X", scenarios: twelve, bootstrapRuns: 1, startingCash: 1200, variants }, "user"), /at most 24 runs/);
    await assert.rejects(suites.start({ name: "X", scenarios: ["covid-crash-2020", "steady-bull-2021", "ai-rally-2023"],
      bootstrapRuns: 2, startingCash: 1200, variants }, "agent"), /at most 8 runs/);
    const ok = await suites.start({ name: "X", scenarios: ["covid-crash-2020"], bootstrapRuns: 1, startingCash: 1200, variants }, "agent");
    assert.equal(ok.runs.length, 4);
  } finally { done(); }
});

test("agent suites default to the subagent model unless a variant sets one", async () => {
  const { runner, suites, done } = setup();
  try {
    await suites.start({ name: "Cheap", scenarios: ["covid-crash-2020"], startingCash: 1200,
      variants: [{ label: "A" }, { label: "B", model: "main" }] }, "agent");
    assert.equal(runner.started.find((s) => s.options?.variant === "A")?.config.model, "subagent");
    assert.equal(runner.started.find((s) => s.options?.variant === "B")?.config.model, "main");
  } finally { done(); }
});

test("summaries pool finished runs per variant", async () => {
  const { runner, suites, done } = setup();
  try {
    const suite = await suites.start({ name: "Stats", scenarios: ["covid-crash-2020", "steady-bull-2021"], startingCash: 1200, variants }, "user");
    const aRuns = suite.runs.filter((e) => e.variant === "A");
    runner.finish(aRuns[0]!.runId, { returnPct: 4, benchmarkReturnPct: 1, maxDrawdownPct: 5, sharpe: 1.2, roundTrips: 4, winRatePct: 50, avgR: 1, costsPct: 0.2, brier: 0.2 });
    runner.finish(aRuns[1]!.runId, { returnPct: 10, benchmarkReturnPct: 2, maxDrawdownPct: 8, sharpe: 1.8, roundTrips: 6, winRatePct: 100, avgR: 2, costsPct: 0.4, brier: 0.1 });
    const summary = suites.get(suite.id)!.summary.find((s) => s.label === "A")!;
    assert.deepEqual({ runs: summary.runs, done: summary.done, failed: summary.failed }, { runs: 2, done: 2, failed: 0 });
    assert.equal(summary.meanReturnPct, 7);
    assert.equal(summary.medianReturnPct, 7);
    assert.ok(Math.abs(summary.p10ReturnPct! - 4.6) < 1e-9);
    assert.ok(Math.abs(summary.p90ReturnPct! - 9.4) < 1e-9);
    assert.equal(summary.meanExcessPct, 5.5);
    assert.equal(summary.beatBenchmarkPct, 100);
    assert.equal(summary.worstDrawdownPct, 8);
    assert.equal(summary.medianSharpe, 1.5);
    assert.equal(summary.winRatePct, 80);
    assert.equal(summary.avgR, 1.6);
    assert.ok(Math.abs(summary.costsPct! - 0.3) < 1e-9);
    assert.ok(Math.abs(summary.brier! - 0.15) < 1e-9);
    const pending = suites.get(suite.id)!.summary.find((s) => s.label === "B")!;
    assert.equal(pending.done, 0);
    assert.equal(pending.meanReturnPct, undefined);
    assert.equal(suites.get(suite.id)!.status, "running");
  } finally { done(); }
});

test("two variants compare on paired markets with a seeded bootstrap interval", async () => {
  const { runner, suites, done } = setup();
  try {
    const suite = await suites.start({ name: "AB", scenarios: ["covid-crash-2020", "steady-bull-2021"], startingCash: 1200, variants }, "user");
    const finish = (variant: string, scenario: string, ret: number, bench: number): void => {
      const entry = suite.runs.find((e) => e.variant === variant && e.scenario === scenario)!;
      runner.finish(entry.runId, { returnPct: ret, benchmarkReturnPct: bench });
    };
    finish("A", "covid-crash-2020", 4, 1);
    finish("A", "steady-bull-2021", 10, 2);
    assert.equal(suites.get(suite.id)!.comparison, undefined);
    finish("B", "covid-crash-2020", 6, 1);
    finish("B", "steady-bull-2021", 13, 1);
    const done2 = suites.get(suite.id)!;
    assert.equal(done2.status, "done");
    assert.equal(done2.comparison?.pairs, 2);
    assert.equal(done2.comparison?.meanDiff, 3);
    assert.deepEqual(done2.comparison?.ci95, bootstrapMeanCI([2, 4], suiteSeed(suite.id, "comparison")));
    const [lo, hi] = done2.comparison!.ci95;
    assert.ok(lo <= 3 && 3 <= hi);
    const reading = comparisonReading(done2);
    assert.ok(reading.startsWith("B beat A by 3.0 points of excess return, 95% interval"));
    assert.ok(reading.endsWith(": conclusive"));
    assert.equal(comparisonReading({ ...done2, status: "running", comparison: undefined }).startsWith("Suite still running"), true);
  } finally { done(); }
});

test("suites finish done when runs complete and failed when every run fails", async () => {
  const { runner, suites, seen, done } = setup();
  try {
    const suite = await suites.start({ name: "Win", scenarios: ["covid-crash-2020"], startingCash: 1200, variants: [{ label: "A" }] }, "user");
    runner.finish(suite.runs[0]!.runId, { returnPct: 2 });
    const finished = suites.get(suite.id)!;
    assert.equal(finished.status, "done");
    assert.ok(finished.finishedAt !== undefined);
    const events = seen.filter((e) => e.type === "sim_suite");
    assert.ok(events.length >= 2);
    assert.equal((events.at(-1) as { suite: { status: string } }).suite.status, "done");
    const lost = await suites.start({ name: "Loss", scenarios: ["covid-crash-2020"], startingCash: 1200, variants: [{ label: "A" }] }, "user");
    runner.finish(lost.runs[0]!.runId, { returnPct: -5, status: "failed" });
    assert.equal(suites.get(lost.id)!.status, "failed");
  } finally { done(); }
});

test("suites reload from disk and fail when their runs are gone", async () => {
  const { runner, suites, dataDir, done } = setup();
  let second: SuiteService | undefined;
  try {
    const finished = await suites.start({ name: "Kept", scenarios: ["covid-crash-2020"], startingCash: 1200, variants: [{ label: "A" }] }, "user");
    runner.finish(finished.runs[0]!.runId, { returnPct: 2 });
    const open = await suites.start({ name: "Open", scenarios: ["covid-crash-2020"], startingCash: 1200, variants: [{ label: "A" }] }, "user");
    suites.close();
    const bus2 = createEventBus();
    const empty = new FakeRunner(bus2);
    second = createSuiteService({ runner: empty, bus: bus2, log, dataDir, now: () => 1_700_000_000_001 });
    assert.equal(second.get(finished.id)?.status, "done");
    assert.equal(second.get(open.id)?.status, "failed");
  } finally { second?.close(); done(); }
});

test("stop ends every unfinished run in the suite", async () => {
  const { runner, suites, done } = setup();
  try {
    const suite = await suites.start({ name: "Halt", scenarios: ["covid-crash-2020", "steady-bull-2021"], startingCash: 1200, variants: [{ label: "A" }] }, "user");
    runner.finish(suite.runs[0]!.runId, { returnPct: 1 });
    const stopped = (await suites.stop(suite.id))!;
    assert.equal(stopped.status, "stopped");
    assert.equal(runner.get(suite.runs[1]!.runId)?.status, "stopped");
    assert.equal(await suites.stop("missing"), undefined);
  } finally { done(); }
});
