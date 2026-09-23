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

export const BrokerGrant = z
  .object({ url: z.string().min(1), credential: BrokerCredential })
  .strict();
export type BrokerGrant = z.infer<typeof BrokerGrant>;

export const BrokerRefusal = z.object({ reason: z.string().min(1) }).strict();
export type BrokerRefusal = z.infer<typeof BrokerRefusal>;
