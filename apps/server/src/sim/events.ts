import type { EventBus } from "../ports.ts";
import { createEventBus } from "../events.ts";

export function createSimEventBus(main: EventBus, simRunId: string): EventBus {
  const local = createEventBus();
  return {
    publish(event) {
      // Status snapshots belong only to the live account's dashboard.
      if (event.type !== "status" && event.type !== "sim") main.publish({ ...event, simRunId });
      local.publish(event);
    },
    subscribe: local.subscribe,
  };
}
