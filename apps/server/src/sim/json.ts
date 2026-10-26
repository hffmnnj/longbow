type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Wire interfaces lack an index signature; serialization also strips undefined optionals. */
export function jsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
