import { z } from "zod";

// A cursor is the sender's alone: a receiver passes it on whatever its JSON shape.
const MetadataSyncCursor = z.json();

// What the receiver asks the sender for. Open, so a newer receiver's keys reach the sender.
export const MetadataSyncRequest = z
  .object({
    database: z.string(),
    engine: z.string(),
    after: MetadataSyncCursor.nullable().optional(),
  })
  .loose();
export type MetadataSyncRequest = z.infer<typeof MetadataSyncRequest>;

export const MetadataSyncRequestInput = z
  .object({
    database_id: z.number().int(),
    after: MetadataSyncCursor.nullable().optional(),
  })
  .strict();
export type MetadataSyncRequestInput = z.infer<typeof MetadataSyncRequestInput>;

// The sender's page. Open all the way down, since the receiver reads each entry itself and a
// newer sender's keys must reach it unchanged.
export const MetadataSyncAnswer = z
  .object({
    format_version: z.number().int(),
    database: z.string(),
    engine: z.string(),
    batches: z.array(z.object({ type: z.string() }).loose()),
    next: MetadataSyncCursor.nullable().optional(),
  })
  .loose();
export type MetadataSyncAnswer = z.infer<typeof MetadataSyncAnswer>;

export const MetadataSyncApplyInput = z
  .object({
    database_id: z.number().int(),
    response: MetadataSyncAnswer,
  })
  .strict();
export type MetadataSyncApplyInput = z.infer<typeof MetadataSyncApplyInput>;

export const MetadataSyncApplied = z
  .object({
    next: MetadataSyncCursor.nullable().optional(),
    counts: z.record(z.string(), z.number().int()),
  })
  .loose();
export type MetadataSyncApplied = z.infer<typeof MetadataSyncApplied>;
