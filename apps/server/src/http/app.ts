import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  CSRF_HEADER,
  OrderDecisionSchema,
  SendMessageSchema,
  SettingsPatchSchema,
  type AccountSnapshot,
  type StatusResponse,
} from "@rh/shared";
import type {
  AgentControl,
  Broker,
  Clock,
  Config,
  EventBus,
  Logger,
  MarketCalendar,
  OrderGate,
  Store,
} from "../ports.ts";
import type { CyclePoint } from "../scheduler/cycles.ts";

export interface AppDeps {
  config: Config;
  store: Store;
  bus: EventBus;
  agent: AgentControl;
  broker: Broker;
  gate: OrderGate;
  calendar: MarketCalendar;
  clock: Clock;
  scheduler: { next(): CyclePoint };
  getAccount: () => AccountSnapshot | null;
  log: Logger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the full status snapshot every status endpoint and event carries. */
export async function buildStatus(deps: AppDeps): Promise<StatusResponse> {
  const settings = deps.store.getSettings();
  const market = deps.calendar.clock(deps.clock.now());
  const halts = await deps.gate.halts();
  const next = deps.scheduler.next();
  const account = deps.getAccount();
  let dayPnl: number | undefined;
  let dayPnlPct: number | undefined;
  if (account !== null) {
    const marks = deps.store.equityMarks(deps.calendar.etDate(account.at));
    if (marks.dayStart !== undefined && marks.dayStart > 0) {
      dayPnl = account.equity - marks.dayStart;
      dayPnlPct = (dayPnl / marks.dayStart) * 100;
    }
  }
  return {
    agent: {
      ...deps.agent.status(),
      nextCycleAt: next.at,
      nextCycleKind: next.kind,
    },
    broker: deps.broker.status(),
    market,
    settings,
    account,
    halts,
    ...(dayPnl !== undefined ? { dayPnl } : {}),
    ...(dayPnlPct !== undefined ? { dayPnlPct } : {}),
  };
}

/** Mutating requests need the CSRF header and, when present, a same-origin Origin. */
function csrfMiddleware(deps: Pick<AppDeps, "config">) {
  return async (
    c: { req: { method: string; header: (name: string) => string | undefined }; json: (o: unknown, s: number) => Response },
    next: () => Promise<void>,
  ) => {
    const method = c.req.method;
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      if (c.req.header(CSRF_HEADER) !== "1") return c.json({ error: "missing required header" }, 403);
      const origin = c.req.header("Origin");
      if (origin !== undefined && origin !== "") {
        const allowed =
          origin === deps.config.PUBLIC_URL ||
          deps.config.HOSTS.some((host) => origin === `http://${host}:${deps.config.PORT}`);
        if (!allowed) return c.json({ error: "forbidden origin" }, 403);
      }
    }
    await next();
  };
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use(csrfMiddleware(deps) as never);

  app.get("/api/status", async (c) => c.json(await buildStatus(deps)));

  app.get("/api/messages", async (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? "200") || 200));
    return c.json(await deps.agent.listMessages(limit));
  });

  app.post("/api/messages", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = SendMessageSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    await deps.agent.sendMessage(parsed.data.text);
    return c.json({ ok: true });
  });

  app.post("/api/cycles", async (c) => {
    await deps.agent.runCycle("manual");
    return c.json({ ok: true });
  });

  app.get("/api/journal", async (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? "100") || 100));
    return c.json(deps.store.listJournal(limit));
  });

  app.get("/api/orders", async (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? "100") || 100));
    return c.json(deps.store.listOrders(limit));
  });

  app.post("/api/orders/:id/approve", async (c) => {
    try {
      return c.json(await deps.gate.approve(c.req.param("id")));
    } catch (error) {
      const message = errorMessage(error);
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400);
    }
  });

  app.post("/api/orders/:id/reject", async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = OrderDecisionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    try {
      return c.json(await deps.gate.reject(c.req.param("id"), parsed.data.reason));
    } catch (error) {
      const message = errorMessage(error);
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400);
    }
  });

  app.get("/api/settings", (c) => c.json(deps.store.getSettings()));

  app.patch("/api/settings", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = SettingsPatchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    const settings = deps.store.patchSettings(parsed.data);
    // The scheduler re-arms off status events, so publishing applies the cadence now.
    deps.bus.publish({ type: "status", status: await buildStatus(deps) });
    return c.json(settings);
  });

  app.get("/api/robinhood/connect", async (c) => {
    try {
      return c.json({ url: await deps.broker.beginConnect() });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  // OAuth callbacks are GETs carrying the provider's query string: exempt from CSRF.
  app.get("/api/robinhood/callback", async (c) => {
    try {
      await deps.broker.completeConnect(new URLSearchParams(new URL(c.req.url).search));
      return c.redirect("/?robinhood=connected");
    } catch {
      deps.log.warn("robinhood connect failed");
      return c.redirect("/?robinhood=error");
    }
  });

  app.post("/api/robinhood/disconnect", async (c) => {
    await deps.broker.disconnect();
    return c.json({ ok: true });
  });

  app.get("/api/events", (_c) => {
    let off: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (line: string): void => {
          try {
            controller.enqueue(encoder.encode(line));
          } catch {
            // Client went away; cancel() cleans up.
          }
        };
        send(`data: ${JSON.stringify({ type: "status", status: await buildStatus(deps) })}\n\n`);
        off = deps.bus.subscribe((event) => {
          send(`data: ${JSON.stringify(event)}\n\n`);
        });
        heartbeat = setInterval(() => send(": ping\n\n"), 25_000);
      },
      cancel() {
        off?.();
        if (heartbeat !== undefined) clearInterval(heartbeat);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // Static UI for everything else, with an index.html SPA fallback.
  const staticMiddleware = serveStatic({ root: deps.config.WEB_DIR });
  app.use(async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    if (!existsSync(deps.config.WEB_DIR)) return next();
    return staticMiddleware(c, next);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
    const index = join(deps.config.WEB_DIR, "index.html");
    if (existsSync(index)) return c.html(readFileSync(index, "utf-8"));
    return c.text("UI is not built. Build apps/web first.", 200);
  });

  return app;
}
