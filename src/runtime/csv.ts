import type { ZodEnum } from "zod";

import { ConfigError } from "../core/errors";

export function parseCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function parseEnumCsv<T extends string>(
  raw: string | undefined,
  schema: ZodEnum<Record<string, T>>,
  flagName: string,
): T[] | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const parts = parseCsv(raw);
  if (parts.length === 0) {
    return undefined;
  }
  const accepted: T[] = [];
  const rejected: string[] = [];
  for (const part of parts) {
    const result = schema.safeParse(part);
    if (result.success) {
      accepted.push(result.data);
    } else {
      rejected.push(part);
    }
  }
  if (rejected.length > 0) {
    const allowed = Object.values(schema.enum).join(", ");
    throw new ConfigError(
      `invalid ${flagName} value: ${rejected.join(", ")} (expected one of: ${allowed})`,
    );
  }
  return accepted;
}

export function parseEnum<T extends string>(
  raw: string | undefined,
  schema: ZodEnum<Record<string, T>>,
  flagName: string,
): T | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const allowed = Object.values(schema.enum).join(", ");
    throw new ConfigError(`invalid ${flagName} value: "${raw}" (expected one of: ${allowed})`);
  }
  return result.data;
}
