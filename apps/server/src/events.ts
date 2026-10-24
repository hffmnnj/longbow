import type { EventBus } from "./ports.ts";
import type { ServerEvent } from "@rh/shared";

/** In-memory fan-out bus. One throwing listener never breaks the others. */
export function createEventBus(): EventBus {
  const listeners = new Set<(event: ServerEvent) => void>();
  return {
    publish(event: ServerEvent): void {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // A broken subscriber must not take down the publisher or peers.
        }
      }
    },
    subscribe(listener: (event: ServerEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
