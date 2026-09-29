import { parseInteger } from "./parse-integer";

export function parseId(value: string, name = "id"): number {
  return parseInteger(value, { name, min: 1 });
}

// Not `parseCsv`: an empty part (`""`, `1,,2`) is a shell expansion that resolved to nothing, and
// dropping it would read the typo as a narrower filter, or as none at all.
export function parseIdCsv(raw: string, name: string): number[] {
  return raw.split(",").map((part) => parseId(part, name));
}
