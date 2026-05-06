import { parseInteger } from "./parse-integer";

export function parseId(value: string, name = "id"): number {
  return parseInteger(value, { name, min: 1 });
}
