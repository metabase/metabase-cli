import { z } from "zod";

import { NonBlankText } from "./text";

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

// The server stores only these two keys, and either ignores or rejects any other, so refuse one
// here rather than let it vanish.
export const GlossaryCreateInput = z
  .object({
    term: NonBlankText,
    definition: NonBlankText,
  })
  .strict();
export type GlossaryCreateInput = z.infer<typeof GlossaryCreateInput>;

export const GlossaryUpdateInput = GlossaryCreateInput;
export type GlossaryUpdateInput = GlossaryCreateInput;
