import { parseInteger } from "./parse-integer";

export function parseId(value: string, name = "id"): number {
  return parseInteger(value, { name, min: 1 });
}

export function parseIdList(value: string | undefined, name = "id"): number[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => parseId(part, name));
}
