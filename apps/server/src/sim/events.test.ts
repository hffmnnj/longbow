import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerEvent } from "@rh/shared";
import { createEventBus } from "../events.ts";
import { createSimEventBus } from "./events.ts";

test("simulation events are tagged on the main bus and kept local to their own listeners", () => {
  const main = createEventBus();
  const sim = createSimEventBus(main, "run-123");
  const mainEvents: ServerEvent[] = [];
  const localEvents: ServerEvent[] = [];
  main.subscribe((event) => mainEvents.push(event));
  sim.subscribe((event) => localEvents.push(event));
  sim.publish({ type: "delta", text: "paper thinking", conversationId: "42" });
  main.publish({ type: "delta", text: "live thinking" });
  assert.deepEqual(mainEvents, [{ type: "delta", text: "paper thinking", conversationId: "42", simRunId: "run-123" }, { type: "delta", text: "live thinking" }]);
  assert.deepEqual(localEvents, [{ type: "delta", text: "paper thinking", conversationId: "42" }]);
});
