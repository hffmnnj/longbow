import type { Hono } from "hono";
import type { PushPayload } from "@rh/shared";
import type { PushService } from "./service.ts";

/**
 * The Android app's notifications. Android WebView has no web push, so the app keeps this event stream open from a
 * foreground service and posts each payload as a native notification: the same title, body, url and tag the web
 * push subscribers get, so both clients notify identically.
 */
export interface NativePushHub {
  /** Wraps the web push service so every send also reaches connected native clients. */
  wrap(push: PushService): PushService;
  mount(app: Hono): void;
  clients(): number;
}

export function createNativePushHub(): NativePushHub {
  const listeners = new Set<(payload: PushPayload) => void>();
  return {
    wrap(push) {
      return {
        ...push,
        send(payload) {
          for (const listener of listeners) listener(payload);
          return push.send(payload);
        },
      };
    },
    clients: () => listeners.size,
    mount(app) {
      app.get("/api/push/native-stream", () => {
        let listener: ((payload: PushPayload) => void) | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const write = (line: string): void => {
              try {
                controller.enqueue(encoder.encode(line));
              } catch {
                // Client went away; cancel() cleans up.
              }
            };
            listener = (payload) => write(`data: ${JSON.stringify(payload)}\n\n`);
            listeners.add(listener);
            write(": connected\n\n");
            heartbeat = setInterval(() => write(": ping\n\n"), 25_000);
          },
          cancel() {
            if (listener !== undefined) listeners.delete(listener);
            if (heartbeat !== undefined) clearInterval(heartbeat);
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        });
      });
    },
  };
}
