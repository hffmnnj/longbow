import type { StatusResponse } from "@rh/shared";

export type Authority = "killed" | "locked" | "off" | "approve" | "auto";

export interface ModelInfo {
  provider: string;
  model: string;
  thinking?: string;
}

/** "openai/gpt-5.5#high" -> provider, model, thinking. Anything unparseable keeps the whole spec as the model. */
export function parseModelSpec(spec: string): ModelInfo {
  const [path = "", thinking] = spec.split("#");
  const slash = path.indexOf("/");
  if (slash < 0) return { provider: "", model: path || spec, thinking };
  return { provider: path.slice(0, slash), model: path.slice(slash + 1), thinking };
}

export interface Capability {
  key: "research" | "propose" | "approve" | "place";
  label: string;
  /** "yes": enabled right now. "gated": needs you or the lock. "no": blocked. */
  state: "yes" | "gated" | "no";
  detail: string;
}

export interface ControlState {
  authority: Authority;
  headline: string;
  detail: string;
  liveLocked: boolean;
  killed: boolean;
  capabilities: Capability[];
}

/**
 * What the system may do right now, in one place. Precedence: kill switch, then the server's live-trading lock,
 * then the mode. A locked server never reaches the broker whatever the mode says.
 */
export function controlState(status: Pick<StatusResponse, "settings" | "liveTrading" | "halts" | "broker">): ControlState {
  const { mode, killSwitch } = status.settings;
  const liveLocked = !status.liveTrading;
  const killed = killSwitch;
  const brokerUp = status.broker.state === "connected";

  const authority: Authority = killed ? "killed" : liveLocked ? "locked" : mode;
  const copy: Record<Authority, [string, string]> = {
    killed: ["Kill switch engaged", "No order of any kind is sent. Research cycles keep running."],
    locked: ["Live trading locked", "The broker is read-only. Orders are risk-checked and recorded, never sent."],
    off: ["Research only", "The agent reads and reasons. It does not propose orders."],
    approve: ["Orders wait for you", "Each risk-approved order is queued until you approve it."],
    auto: ["Auto: orders place themselves", "Risk-approved orders go to Robinhood without waiting for you."],
  };
  const [headline, detail] = copy[authority];

  const canTrade = !killed && !liveLocked && brokerUp;
  const capabilities: Capability[] = [
    { key: "research", label: "Research the market", state: "yes", detail: "Always on, read-only" },
    {
      key: "propose",
      label: "Propose orders",
      state: killed ? "no" : mode === "off" ? "no" : "yes",
      detail: killed ? "Blocked by the kill switch" : mode === "off" ? "Mode is Off" : "Checked by the risk engine first",
    },
    {
      key: "approve",
      label: "Queue orders for approval",
      state: killed || mode === "off" ? "no" : mode === "approve" ? "yes" : "gated",
      detail: mode === "approve" ? "You decide each one" : mode === "auto" ? "Skipped in Auto" : "Mode is Off",
    },
    {
      key: "place",
      label: "Place orders on Robinhood",
      state: !canTrade || mode === "off" ? "no" : mode === "auto" ? "yes" : "gated",
      detail: killed
        ? "Blocked by the kill switch"
        : liveLocked
          ? "Live trading is locked on the server"
          : !brokerUp
            ? "Robinhood is not connected"
            : mode === "auto"
              ? "Immediately after the risk check"
              : mode === "approve"
                ? "Only after you approve"
                : "Mode is Off",
    },
  ];

  return { authority, headline, detail, liveLocked, killed, capabilities };
}
