import { z, type ZodType } from "zod";

export type Format = "json" | "text";

// Sized to stay under agent-harness tool-output truncation (~30k chars in Claude Code's Bash
// tool): the CLI's own cap must fire, with its teaching error, before the transport silently
// cuts JSON mid-object.
export const DEFAULT_MAX_BYTES = 24576;

export interface TruncationInfo {
  reason: "max_bytes";
  bytes: number;
}

export interface ListEnvelope<T> {
  data: T[];
  returned: number;
  total?: number | null | undefined;
  limit?: number | undefined;
  truncated?: TruncationInfo | undefined;
}

export function listEnvelopeSchema<T>(item: ZodType<T>): ZodType<ListEnvelope<T>> {
  return z.object({
    data: z.array(item),
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable().optional(),
    limit: z.number().int().nonnegative().optional(),
    truncated: z
      .object({
        reason: z.literal("max_bytes"),
        bytes: z.number().int().nonnegative(),
      })
      .optional(),
  });
}

export function wrapList<T>(items: T[]): ListEnvelope<T> {
  return { data: items, returned: items.length, total: items.length };
}

export interface RenderOptions {
  format: Format;
  full: boolean;
  fields: string[] | undefined;
  maxBytes: number;
  oversizeHint?: string | undefined;
}
