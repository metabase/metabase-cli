import { z } from "zod";

export const ProviderKind = z.enum(["claude", "codex"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const PROVIDER_KINDS: readonly ProviderKind[] = ProviderKind.options;

export const ProviderStatus = z.enum(["ready", "unauthenticated", "error", "missing"]);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const ProviderAccount = z
  .object({
    label: z.string().min(1),
    email: z.string().nullable(),
  })
  .strict();
export type ProviderAccount = z.infer<typeof ProviderAccount>;

// `resolvedId` is the model an alias runs on, as a running session reports it; null when the agent
// names its models by that id already.
export const ProviderModel = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    resolvedId: z.string().min(1).nullable(),
  })
  .strict();
export type ProviderModel = z.infer<typeof ProviderModel>;

export const ProviderHealth = z
  .object({
    kind: ProviderKind,
    installed: z.boolean(),
    path: z.string().nullable(),
    version: z.string().nullable(),
    status: ProviderStatus,
    account: ProviderAccount.nullable(),
    models: z.array(ProviderModel).min(1),
    defaultModel: z.string().min(1),
    message: z.string().nullable(),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export type ProviderHealth = z.infer<typeof ProviderHealth>;

export const ProviderHealthList = z.array(ProviderHealth);
export type ProviderHealthList = z.infer<typeof ProviderHealthList>;

export const PROVIDER_LABELS: Readonly<Record<ProviderKind, string>> = {
  claude: "Claude Code",
  codex: "Codex",
};
