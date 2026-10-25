import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { Hono } from "hono";
import type { SimService } from "../sim/runner.ts";
import { createSuiteService } from "../sim/suite.ts";
import { FakeRunner } from "../sim/suite-fake.ts";
import { createEventBus } from "../events.ts";
import type { Logger } from "../ports.ts";
import { mountSimRoutes } from "./sim-routes.ts";

const log: Logger = { info() {}, warn() {}, error() {}, child() { return this; } };

function setup(withSuites = true) {
  const dataDir = mkdtempSync("/tmp/sim-routes-test-");
  const bus = createEventBus();
  const runner = new FakeRunner(bus);
  const suites = createSuiteService({ runner, bus, log, dataDir });
  const sim = { list: () => [], get: () => undefined, stop: async () => undefined,
    messages: async () => [], journal: () => [], orders: () => [] } as unknown as SimService;
  const app = new Hono();
  mountSimRoutes(app, withSuites ? { sim, log, suites } : { sim, log });
  return { dataDir, runner, suites, app,
    done() { suites.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

const suiteBody = { name: "Route check", scenarios: ["covid-crash-2020"], startingCash: 1200, variants: [{ label: "A" }, { label: "B" }] };

test("suite routes list scenarios, create suites, and report missing suites", async () => {
  const { suites, app, done } = setup();
  try {
    const scenarios = await (await app.request("/api/sim/scenarios")).json() as { id: string }[];
    assert.ok(scenarios.some((s) => s.id === "covid-crash-2020"));
    assert.equal((await app.request("/api/sim/suites/missing")).status, 404);
    const created = await app.request("/api/sim/suites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(suiteBody) });
    assert.equal(created.status, 201);
    const suite = await created.json() as { id: string; runs: { runId: string }[] };
    assert.equal(suite.runs.length, 2);
    assert.equal(((await (await app.request("/api/sim/suites")).json()) as unknown[]).length, 1);
    assert.equal(((await (await app.request(`/api/sim/suites/${suite.id}`)).json()) as { id: string }).id, suite.id);
    assert.equal(suites.get(suite.id)?.status, "running");
  } finally { done(); }
});

test("suite creation rejects invalid input with the validation message", async () => {
  const { app, done } = setup();
  try {
    const bad = await app.request("/api/sim/suites", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bad", scenarios: [], startingCash: 1200, variants: [] }) });
    assert.equal(bad.status, 400);
    assert.ok(typeof ((await bad.json()) as { error: string }).error === "string");
    const unknown = await app.request("/api/sim/suites", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...suiteBody, scenarios: ["nope"] }) });
    assert.equal(unknown.status, 400);
    assert.match(((await unknown.json()) as { error: string }).error, /Unknown scenario/);
  } finally { done(); }
});

test("suite stop ends the suite and 404s on unknown ids", async () => {
  const { runner, app, done } = setup();
  try {
    const created = await app.request("/api/sim/suites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(suiteBody) });
    const suite = await created.json() as { id: string; runs: { runId: string }[] };
    assert.equal((await app.request("/api/sim/suites/missing/stop", { method: "POST" })).status, 404);
    const stopped = await app.request(`/api/sim/suites/${suite.id}/stop`, { method: "POST" });
    assert.equal(stopped.status, 200);
    assert.equal(((await stopped.json()) as { status: string }).status, "stopped");
    assert.ok(suite.runs.every((e) => runner.get(e.runId)?.status === "stopped"));
  } finally { done(); }
});

test("suite routes report 503 when no suite service is mounted", async () => {
  const { app, done } = setup(false);
  try {
    assert.equal((await app.request("/api/sim/suites")).status, 503);
    assert.equal((await app.request("/api/sim/suites/x")).status, 503);
    assert.equal((await app.request("/api/sim/suites", { method: "POST" })).status, 503);
    assert.equal((await app.request("/api/sim/suites/x/stop", { method: "POST" })).status, 503);
  } finally { done(); }
});
