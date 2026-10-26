export const FALLBACK = "Earlier context was compacted natively by OpenAI Codex; only the retained recent history is available to this model.";
const PREFIX = "[LONGBOW_CODEX_COMPACTION_V1:";
const SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const SUMMARY_SUFFIX = "\n</summary>";
export const MAX_ITEM_BYTES = 2 * 1024 * 1024;

export interface CompactionItem extends Record<string, unknown> {
  type: "compaction";
  encrypted_content: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateItem(value: unknown): CompactionItem {
  if (!isRecord(value) || value["type"] !== "compaction" ||
      typeof value["encrypted_content"] !== "string" || value["encrypted_content"].length === 0 ||
      Buffer.byteLength(JSON.stringify(value)) > MAX_ITEM_BYTES) {
    throw new Error("invalid_compaction_item");
  }
  return { ...value, type: "compaction", encrypted_content: value["encrypted_content"] };
}

export function encodeCheckpoint(item: CompactionItem): string {
  const encoded = Buffer.from(JSON.stringify({ version: 1, item: validateItem(item) })).toString("base64");
  return `${FALLBACK}\n${PREFIX}${encoded}]`;
}

function decodeSummary(text: string): CompactionItem | undefined {
  const start = `${SUMMARY_PREFIX}${FALLBACK}\n${PREFIX}`;
  const end = `]${SUMMARY_SUFFIX}`;
  if (!text.startsWith(start) || !text.endsWith(end)) return undefined;
  const encoded = text.slice(start.length, -end.length);
  if (encoded.length > MAX_ITEM_BYTES * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return undefined;
  try {
    const checkpoint: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return isRecord(checkpoint) && checkpoint["version"] === 1 ? validateItem(checkpoint["item"]) : undefined;
  } catch {
    return undefined;
  }
}

/** Also strips embedded markers in regular summarizer transcripts and cross-model copies. */
function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\[LONGBOW_CODEX_COMPACTION_V1:[^\]]*(?:\]|$)/g, FALLBACK);
  if (Array.isArray(value)) {
    const next = value.map(scrub);
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, scrub(item)] as const);
    return entries.some(([key, item]) => item !== value[key]) ? Object.fromEntries(entries) : value;
  }
  return value;
}

/** Only exact pi-durable summary messages can become provider-native items. Never mutate the stored transcript. */
export function replayPayload(payload: unknown, native: boolean): unknown {
  let result = payload;
  if (native && isRecord(payload) && Array.isArray(payload["input"])) {
    let changed = false;
    const input = payload["input"].map((message: unknown) => {
      if (!isRecord(message) || message["role"] !== "user" || !Array.isArray(message["content"]) || message["content"].length !== 1) return message;
      const part: unknown = message["content"][0];
      if (!isRecord(part) || part["type"] !== "input_text" || typeof part["text"] !== "string") return message;
      const item = decodeSummary(part["text"]);
      if (item === undefined) return message;
      changed = true;
      return item;
    });
    if (changed) result = { ...payload, input };
  }
  return scrub(result);
}
