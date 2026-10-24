/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";
import type { PushPayload } from "@rh/shared";

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL = `shell-${version}`;
const API = "api-status-v1";
const STATUS_PATH = "/api/status";
const PRECACHE = ["/", ...build, ...files];

sw.addEventListener("install", (event) => {
  // No skipWaiting here: a new worker waits so the app can offer "Update ready".
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL && key !== API) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void sw.skipWaiting();
});

/** Network first; remember only /api/status, stamped so the app can tell it is stale. */
async function status(request: Request): Promise<Response> {
  const cache = await caches.open(API);
  try {
    const res = await fetch(request);
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set("x-harness-cached-at", String(Date.now()));
      void cache.put(STATUS_PATH, new Response(await res.clone().blob(), { status: res.status, headers }));
    }
    return res;
  } catch (err) {
    const hit = await cache.match(STATUS_PATH);
    if (hit) return hit;
    throw err;
  }
}

async function shell(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL);
  if (request.mode === "navigate") {
    try {
      return await fetch(request);
    } catch {
      return (await cache.match("/")) ?? Response.error();
    }
  }
  // Only what install precached (versioned by `version`) is served from cache; nothing is added at runtime.
  return (await cache.match(request)) ?? fetch(request);
}

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    // SSE, OAuth and every other API route go straight to the network, uncached.
    if (url.pathname === STATUS_PATH) event.respondWith(status(request));
    return;
  }
  event.respondWith(shell(request));
});

sw.addEventListener("push", (event) => {
  let payload: PushPayload = { title: "Longbow", body: "" };
  try {
    payload = { ...payload, ...(event.data?.json() as Partial<PushPayload>) };
  } catch {
    const text = event.data?.text();
    if (text) payload.body = text;
  }
  event.waitUntil(
    sw.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? "/", sw.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === sw.location.origin);
      if (open) {
        await open.focus();
        if (open.url !== target && "navigate" in open) await (open as WindowClient).navigate(target).catch(() => {});
        return;
      }
      await sw.clients.openWindow(target);
    })(),
  );
});
