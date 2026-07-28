import { z, type ZodType } from "zod";

export type Format = "json" | "text";

// Sized to stay under agent-harness tool-output truncation (~30k chars in Claude Code's Bash
// tool): the CLI's own cap must fire, with its teaching error, before the transport silently
// cuts JSON mid-object.
export const DEFAULT_MAX_BYTES = 24576;

// `bytes` is what the envelope would have serialized to had nothing been dropped — the size of
// the answer being asked for, measured over the same projection the output uses. It is deliberately
// not the size of what came back, which is bounded by `--max-bytes` and so says nothing new.
interface TruncationInfo {
  reason: "max_bytes";
  bytes: number;
}

export interface ListEnvelope<T> {
  data: T[];
  returned: number;
  offset: number;
  limit?: number | undefined;
  total?: number | null | undefined;
  has_more: boolean;
  next_offset?: number | null | undefined;
  truncated?: TruncationInfo | undefined;
}

export function listEnvelopeSchema<T>(item: ZodType<T>): ZodType<ListEnvelope<T>> {
  return z.object({
    data: z.array(item).describe("The items in this window."),
    returned: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of items in `data`; a short window is not proof the walk is over."),
    offset: z
      .number()
      .int()
      .nonnegative()
      .describe("Index of the first item in `data` within the full result set."),
    limit: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Echoes `--limit` when you passed one, and is absent otherwise."),
    total: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe(
        "The server's count on endpoints that report one and `null` on those that don't, so it is a display value rather than a loop bound.",
      ),
    has_more: z
      .boolean()
      .describe(
        "True when more items exist beyond this window; this alone decides whether to keep going, never a comparison of counts. True with a `null` next_offset means the remaining items are reached by widening `--max-bytes` or narrowing the selection, not by paging.",
      ),
    next_offset: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe(
        "Pass back as `--offset` to fetch the next window; it is past the offset you sent, and `null` when there is nowhere to resume from — either the walk is over or `--max-bytes` left no room for a single row, which `truncated` tells apart.",
      ),
    truncated: z
      .object({
        reason: z.literal("max_bytes"),
        bytes: z.number().int().nonnegative(),
      })
      .optional()
      .describe(
        "Present when the `--max-bytes` cap cut the output, not when the data ran out; its `bytes` is what the untruncated answer would have measured, so narrow rows with `--fields` rather than raising the cap.",
      ),
  });
}

// The window a list command was asked to return; it flows through to server-side paging when the
// endpoint supports it, and is applied client-side when it does not.
export interface ListRange {
  offset: number;
  limit: number | undefined;
}

export const FULL_RANGE: ListRange = { offset: 0, limit: undefined };

export interface RenderOptions {
  format: Format;
  full: boolean;
  fields: string[] | undefined;
  maxBytes: number;
  oversizeHint?: string | undefined;
}

export interface ListOptions extends RenderOptions {
  range: ListRange;
}
