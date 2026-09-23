import { z } from "zod";

import { ConnectedUser, ServerSummary } from "./settings";

const Disconnected = z.object({ kind: z.literal("disconnected") }).strict();

const Connected = z
  .object({
    kind: z.literal("connected"),
    url: z.string().min(1),
    user: ConnectedUser,
    server: ServerSummary,
    connectedAt: z.iso.datetime(),
  })
  .strict();

const SignedOut = z
  .object({
    kind: z.literal("signed-out"),
    url: z.string().min(1),
    user: ConnectedUser,
    reason: z.string().min(1),
  })
  .strict();

const Stale = z
  .object({
    kind: z.literal("stale"),
    url: z.string().min(1),
    user: ConnectedUser,
    server: ServerSummary,
    lastProbeAt: z.iso.datetime(),
    reason: z.string().min(1),
  })
  .strict();

export const ConnectionState = z.discriminatedUnion("kind", [
  Disconnected,
  Connected,
  SignedOut,
  Stale,
]);
export type ConnectionState = z.infer<typeof ConnectionState>;

export const DISCONNECTED: ConnectionState = { kind: "disconnected" };

export const ConnectRequest = z
  .object({
    url: z.string().min(1),
    apiKey: z.string().min(1).nullable(),
  })
  .strict();
export type ConnectRequest = z.infer<typeof ConnectRequest>;

const ConnectFailed = z
  .object({
    kind: z.literal("failed"),
    message: z.string().min(1),
  })
  .strict();

export const ConnectOutcome = z.discriminatedUnion("kind", [Connected, ConnectFailed]);
export type ConnectOutcome = z.infer<typeof ConnectOutcome>;

const AuthMethodOAuth = z.object({ kind: z.literal("oauth") }).strict();

const AuthMethodApiKey = z
  .object({ kind: z.literal("apiKey"), reason: z.string().min(1) })
  .strict();

const AuthMethodUnreachable = z
  .object({ kind: z.literal("unreachable"), message: z.string().min(1) })
  .strict();

export const AuthMethod = z.discriminatedUnion("kind", [
  AuthMethodOAuth,
  AuthMethodApiKey,
  AuthMethodUnreachable,
]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export const ProbeRequest = z.object({ url: z.string().min(1) }).strict();
export type ProbeRequest = z.infer<typeof ProbeRequest>;

export const SessionEnvironment = z
  .object({
    sessionId: z.string().min(1),
    MB_URL: z.string().min(1),
    MB_AUTH_BROKER: z.string().min(1),
    MB_AUTH_BROKER_TOKEN: z.string().min(1),
  })
  .strict();
export type SessionEnvironment = z.infer<typeof SessionEnvironment>;
