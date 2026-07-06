import { ConfigError } from "../core/errors";
import { parseCsv } from "../runtime/csv";

import { parseInteger } from "./parse-integer";

export function parseId(value: string, name = "id"): number {
  return parseInteger(value, { name, min: 1 });
}

export function parseIdCsv(value: string, name: string): number[] {
  const ids = parseCsv(value).map((part) => parseId(part, name));
  if (ids.length === 0) {
    throw new ConfigError(`expected at least one ${name} (comma separated)`);
  }
  return ids;
}
