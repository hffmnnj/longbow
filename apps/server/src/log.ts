import type { Logger } from "./ports.ts";

const REDACT = /(authorization|cookie|password|secret|token|api[_-]?key|access|refresh)/i;

function safe(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : v]));
}

export function createLogger(scope = "app"): Logger {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...safe(fields) });
    (level === "error" ? process.stderr : process.stdout).write(line + "\n");
  };
  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (s) => createLogger(`${scope}.${s}`),
  };
}
