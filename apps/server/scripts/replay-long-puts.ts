import { readFileSync, statSync, type Stats } from "node:fs";
import { replayLongPuts } from "../src/sim/put-replay.ts";

/**
 * Offline long-put replay.
 *
 * Usage: node apps/server/scripts/replay-long-puts.ts <input.json>
 *
 * Reads one local JSON file of at most 8 MiB, calls the synchronous replay,
 * and prints its JSON result. It never contacts Robinhood or the network,
 * never reads the harness database, and never places an order.
 */

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function fail(message: string): never {
  console.error(`replay-long-puts: ${message}`);
  process.exit(1);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readInput(path: string): unknown {
  let stats: Stats;
  try {
    stats = statSync(path);
  } catch (error) {
    fail(`cannot read ${path}: ${describe(error)}`);
  }
  if (!stats.isFile()) fail(`${path} is not a regular file`);
  if (stats.size > MAX_INPUT_BYTES) fail(`${path} is larger than 8 MiB`);

  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${describe(error)}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${path} is not valid JSON: ${describe(error)}`);
  }
}

const [inputPath, ...extra] = process.argv.slice(2);
if (inputPath === undefined || extra.length > 0) {
  fail("usage: node apps/server/scripts/replay-long-puts.ts <input.json>");
}

const value = readInput(inputPath);

let result: unknown;
try {
  result = replayLongPuts(value);
} catch (error) {
  fail(`replay failed: ${describe(error)}`);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
