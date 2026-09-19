import { z } from "zod";

export const RevisionEntity = z.enum([
  "card",
  "dashboard",
  "document",
  "measure",
  "segment",
  "transform",
]);
export type RevisionEntity = z.infer<typeof RevisionEntity>;

const RevisionUser = z
  .object({
    id: z.number().int(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    common_name: z.string(),
  })
  .loose();

// `diff` is whatever the entity's differ reports between this revision and the previous visible
// one: `{ before, after }` snapshots by default, per-field `{ before?, after }` for a segment or a
// measure, `null` for the oldest revision. `description` is the same change in a sentence.
export const Revision = z
  .object({
    id: z.number().int(),
    timestamp: z.string(),
    is_creation: z.boolean(),
    is_reversion: z.boolean(),
    most_recent: z.boolean(),
    diff: z.object({}).loose().nullable(),
    description: z.string(),
    has_multiple_changes: z.boolean(),
    user: RevisionUser,
  })
  .loose();
export type Revision = z.infer<typeof Revision>;

export const RevisionCompact = Revision.pick({
  id: true,
  timestamp: true,
  is_creation: true,
  is_reversion: true,
  description: true,
  user: true,
}).strip();
export type RevisionCompact = z.infer<typeof RevisionCompact>;

// The stored row, as a revert answers it when the entity already matched the revision asked for:
// the snapshot it holds and no diff, description or user details.
export const RevisionRow = z
  .object({
    id: z.number().int(),
    model: z.string(),
    model_id: z.number().int(),
    user_id: z.number().int(),
    object: z.object({}).loose(),
    timestamp: z.string(),
    is_creation: z.boolean(),
    is_reversion: z.boolean(),
    most_recent: z.boolean(),
  })
  .loose();
export type RevisionRow = z.infer<typeof RevisionRow>;

export const RevisionRevertInput = z
  .object({
    entity: RevisionEntity,
    id: z.number().int().positive(),
    revision_id: z.number().int().positive(),
  })
  .strict();
export type RevisionRevertInput = z.infer<typeof RevisionRevertInput>;

const RevisionReverted = z.object({
  outcome: z.literal("reverted"),
  revision: Revision,
});

const RevisionUnchanged = z.object({
  outcome: z.literal("unchanged"),
  revision: RevisionRow,
});

// A revert that changed the entity records a new reversion revision and answers it with details; a
// revert to the state the entity is already in records nothing and answers the latest stored row.
export const RevisionRevert = z.discriminatedUnion("outcome", [
  RevisionReverted,
  RevisionUnchanged,
]);
export type RevisionRevert = z.infer<typeof RevisionRevert>;
