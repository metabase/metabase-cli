import { z } from "zod";

export const SessionCreateInput = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();
export type SessionCreateInput = z.infer<typeof SessionCreateInput>;

export const Session = z
  .object({
    id: z.string(),
  })
  .loose();
export type Session = z.infer<typeof Session>;

export const SessionCompact = Session.pick({
  id: true,
}).strip();
export type SessionCompact = z.infer<typeof SessionCompact>;
