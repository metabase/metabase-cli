import { z, type ZodType } from "zod";

export type Format = "json" | "text";
export type Detail = "compact" | "full" | "fields";

export const DEFAULT_MAX_BYTES = 65536;

export interface TruncationInfo {
  reason: "max_bytes";
  bytes: number;
}

export interface ListEnvelope<T> {
  data: T[];
  returned: number;
  total?: number | undefined;
  limit?: number | undefined;
  truncated?: TruncationInfo | undefined;
}

export function listEnvelopeSchema<T>(item: ZodType<T>): ZodType<ListEnvelope<T>> {
  return z.object({
    data: z.array(item),
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    limit: z.number().int().nonnegative().optional(),
    truncated: z
      .object({
        reason: z.literal("max_bytes"),
        bytes: z.number().int().nonnegative(),
      })
      .optional(),
  });
}

export interface RenderOptions {
  format: Format;
  detail: Detail;
  fields: string[] | undefined;
  maxBytes: number;
}
