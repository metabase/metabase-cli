import { z } from "zod";

const BrokerOAuthCredential = z
  .object({
    kind: z.literal("oauth"),
    accessToken: z.string().min(1),
    expiresAt: z.iso.datetime(),
  })
  .strict();

const BrokerApiKeyCredential = z
  .object({ kind: z.literal("apiKey"), apiKey: z.string().min(1) })
  .strict();

export const BrokerCredential = z.discriminatedUnion("kind", [
  BrokerOAuthCredential,
  BrokerApiKeyCredential,
]);
export type BrokerCredential = z.infer<typeof BrokerCredential>;

// `worktreeId` is the remote-sync worktree the session's every request carries, `null` for the
// main app. The broker names it, never the session's environment.
export const BrokerGrant = z
  .object({
    url: z.string().min(1),
    credential: BrokerCredential,
    worktreeId: z.number().int().positive().nullable(),
  })
  .strict();
export type BrokerGrant = z.infer<typeof BrokerGrant>;

export const BrokerRefusal = z.object({ reason: z.string().min(1) }).strict();
export type BrokerRefusal = z.infer<typeof BrokerRefusal>;
