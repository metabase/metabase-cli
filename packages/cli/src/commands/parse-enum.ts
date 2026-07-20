import type { z } from "zod";

import { ConfigError } from "../core/errors";

interface EnumSchema<T extends string> extends z.ZodType<T> {
  options: readonly T[];
}

export function parseEnumFlag<T extends string>(
  value: string,
  schema: EnumSchema<T>,
  name: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new ConfigError(
    `invalid ${name}: "${value}" (expected one of: ${schema.options.join(", ")})`,
  );
}
