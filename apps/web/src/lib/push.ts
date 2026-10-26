/** VAPID public keys arrive base64url; `pushManager.subscribe` wants the raw bytes. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "on" | "off" | "blocked" | "unsupported";

export const PUSH_LABEL: Record<PushState, string> = {
  on: "On",
  off: "Off",
  blocked: "Blocked",
  unsupported: "Not supported",
};

/** iPhone or iPad in a Safari tab, where web push only exists once the app is on the Home Screen. */
export function needsHomeScreen(env: { ua: string; touchMac: boolean; standalone: boolean }): boolean {
  const ios = /iPhone|iPad|iPod/.test(env.ua) || env.touchMac;
  return ios && !env.standalone;
}
