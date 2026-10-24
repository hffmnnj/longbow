import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { SimRun } from "@rh/shared";
import { createSimService } from "./runner.ts";
import { mountSimRoutes } from "../http/sim-routes.ts";
import { createEventBus } from "../events.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { loadConfig } from "../config.ts";
import type { Logger, MarketData, SkillLibrary } from "../ports.ts";

const log: Logger = { info() {}, warn() {}, error() {}, child() { return this; } };
const market: MarketData = { async history(symbol) { return { symbol, asOf: 0, source: "fixture", bars: [] }; }, async nextEarnings() { return undefined; }, async avgDollarVolume() { return undefined; } };
const skills: SkillLibrary = { list: () => [], get: () => undefined, readFile: async () => "" };

test("restart marks interrupted runs failed, retains results, and never seeds credentials", async () => {
  const dataDir = mkdtempSync("/tmp/sim-test-");
  const runDir = join(dataDir, "sim", "old-run");
  mkdirSync(runDir, { recursive: true });
  const run: SimRun = { id: "old-run", createdAt: 1, startedBy: "user", config: { startDate: "2026-07-01", days: 1, startingCash: 1200, cyclesPerDay: 2 },
    status: "running", progress: { day: 1, days: 1, cycle: 1, cyclesPerDay: 2 }, equity: [], fills: [], positions: [] };
  writeFileSync(join(runDir, "run.json"), JSON.stringify(run));
  writeFileSync(join(runDir, "messages.json"), JSON.stringify([{ id: "1", at: 1, role: "assistant", text: "Saved replay" }]));
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills, calendar: createNyseCalendar() });
  try {
    assert.equal(sim.get(run.id)?.status, "failed");
    assert.equal(sim.get(run.id)?.error, "interrupted by restart");
    assert.equal(JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")).status, "failed");
    assert.deepEqual((await sim.messages(run.id, 200)).map((m) => m.text), ["Saved replay"]);
    await assert.rejects(sim.messages(run.id, 1, "../../credentials"), /Unknown conversation/);
    assert.equal(existsSync(join(dataDir, "credentials")), false);
    assert.equal(existsSync(join(dataDir, "app.sqlite")), false);
    const copy = sim.get(run.id)!; copy.status = "done";
    assert.equal(sim.get(run.id)?.status, "failed");
  } finally {
    await sim.close();
    unlinkSync(join(runDir, "run.json")); unlinkSync(join(runDir, "messages.json")); rmdirSync(runDir); rmdirSync(join(dataDir, "sim")); rmdirSync(dataDir);
  }
});

test("simulation HTTP validates configuration, reports missing runs, and caps transcript limits", async () => {
  const dataDir = mkdtempSync("/tmp/sim-http-test-");
  const runDir = join(dataDir, "sim", "done-run"); mkdirSync(runDir, { recursive: true });
  const run: SimRun = { id: "done-run", createdAt: 1, startedBy: "user", config: { startDate: "2026-07-01", days: 1, startingCash: 1200, cyclesPerDay: 2 },
    status: "done", progress: { day: 1, days: 1, cycle: 2, cyclesPerDay: 2 }, equity: [], fills: [], positions: [] };
  writeFileSync(join(runDir, "run.json"), JSON.stringify(run));
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills, calendar: createNyseCalendar() });
  const app = new Hono(); mountSimRoutes(app, { sim, log });
  try {
    assert.equal((await app.request("/api/sim/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 0 }) })).status, 400);
    assert.equal((await app.request("/api/sim/runs", { method: "POST", body: "{" })).status, 400);
    assert.equal((await app.request("/api/sim/runs/missing")).status, 404);
    assert.equal((await app.request("/api/sim/runs/done-run/messages?limit=999999")).status, 400);
    assert.deepEqual(await (await app.request("/api/sim/runs/done-run/journal")).json(), []);
    assert.deepEqual(await (await app.request("/api/sim/runs/done-run/orders")).json(), []);
    assert.equal(((await (await app.request("/api/sim/runs")).json()) as SimRun[])[0]!.id, "done-run");
    const future = { ...run.config, startDate: "2099-01-01" };
    const response = await app.request("/api/sim/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(future) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Simulation must start in the past" });
  } finally {
    await sim.close(); unlinkSync(join(runDir, "run.json")); rmdirSync(runDir); rmdirSync(join(dataDir, "sim")); rmdirSync(dataDir);
  }
});
