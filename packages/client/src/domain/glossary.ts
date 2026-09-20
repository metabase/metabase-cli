import { z } from "zod";

const GlossaryCreator = z
  .object({
    id: z.number().int(),
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  })
  .loose();

export const Glossary = z
  .object({
    id: z.number().int(),
    term: z.string(),
    definition: z.string(),
    creator_id: z.number().int(),
    creator: GlossaryCreator,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type Glossary = z.infer<typeof Glossary>;

export const GlossaryCompact = Glossary.pick({
  id: true,
  term: true,
  definition: true,
}).strip();
export type GlossaryCompact = z.infer<typeof GlossaryCompact>;

// The server closes the body map, so a key beyond these two is a 400 there; refuse it here instead.
export const GlossaryCreateInput = z
  .object({
    term: z.string().min(1),
    definition: z.string().min(1),
  })
  .strict();
export type GlossaryCreateInput = z.infer<typeof GlossaryCreateInput>;

export const GlossaryUpdateInput = GlossaryCreateInput;
export type GlossaryUpdateInput = GlossaryCreateInput;
