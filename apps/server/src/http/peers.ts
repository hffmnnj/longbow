/**
 * Who may talk to the server when it listens on every interface. The app has no login, so the network is the
 * boundary: this machine and the tailnet (Tailscale's 100.64.0.0/10 and fd7a:115c:a1e0::/48) only. A laptop on
 * café or home Wi-Fi must never expose a live trading account to the local network.
 */
export function isAllowedPeer(address: string | undefined): boolean {
  if (address === undefined || address === "") return false;
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  const parts = v4.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number) as [number, number];
    return a === 127 || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = address.toLowerCase();
  return v6 === "::1" || v6.startsWith("fd7a:115c:a1e0:");
}
