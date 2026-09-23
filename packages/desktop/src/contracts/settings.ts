import { z } from "zod";

import { PermissionMode } from "./events";
import { PanelLayout } from "./layout";
import { ProviderKind } from "./providers";

export const Theme = z.enum(["light", "dark"]);
export type Theme = z.infer<typeof Theme>;

export const ThemePreference = z.enum(["light", "dark", "system"]);
export type ThemePreference = z.infer<typeof ThemePreference>;

export const ConnectedUser = z
  .object({
    id: z.number().int(),
    email: z.string(),
    name: z.string(),
    isSuperuser: z.boolean(),
  })
  .strict();
export type ConnectedUser = z.infer<typeof ConnectedUser>;

export const ConnectedFeatures = z
  .object({
    remoteSync: z.boolean(),
    transforms: z.boolean(),
    transformTests: z.boolean(),
  })
  .strict();
export type ConnectedFeatures = z.infer<typeof ConnectedFeatures>;

export const ServerSummary = z
  .object({
    version: z.string().nullable(),
    edition: z.enum(["oss", "ee"]).nullable(),
    features: ConnectedFeatures,
  })
  .strict();
export type ServerSummary = z.infer<typeof ServerSummary>;

export const RepositoryLayout = z.enum(["representation", "empty", "other"]);
export type RepositoryLayout = z.infer<typeof RepositoryLayout>;

export const RepositorySnapshot = z
  .object({
    path: z.string().min(1),
    remote: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    layout: RepositoryLayout,
  })
  .strict();
export type RepositorySnapshot = z.infer<typeof RepositorySnapshot>;

export const TrackedFiles = z
  .object({ paths: z.array(z.string().min(1)), truncated: z.boolean() })
  .strict();
export type TrackedFiles = z.infer<typeof TrackedFiles>;

export const ProviderPreference = z
  .object({
    enabled: z.boolean(),
    binaryPath: z.string().min(1).nullable(),
  })
  .strict();
export type ProviderPreference = z.infer<typeof ProviderPreference>;

const StoredApiKeyCredential = z
  .object({ kind: z.literal("apiKey"), apiKey: z.string().min(1) })
  .strict();

const StoredOAuthCredential = z
  .object({
    kind: z.literal("oauth"),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.iso.datetime(),
    clientId: z.string().min(1),
  })
  .strict();

export const StoredCredential = z.discriminatedUnion("kind", [
  StoredApiKeyCredential,
  StoredOAuthCredential,
]);
export type StoredCredential = z.infer<typeof StoredCredential>;

const StoredConnection = z
  .object({
    url: z.string().min(1),
    credentialBlob: z.base64(),
    user: ConnectedUser,
    server: ServerSummary,
    connectedAt: z.iso.datetime(),
  })
  .strict();
export type StoredConnection = z.infer<typeof StoredConnection>;

// What a new session starts on until the composer picks otherwise for that session alone.
export const AgentDefaults = z
  .object({
    models: z.record(ProviderKind, z.string().min(1)),
    permissionMode: PermissionMode,
  })
  .strict();
export type AgentDefaults = z.infer<typeof AgentDefaults>;

export const SETTINGS_VERSION = 6;

// `worktreeRoot` is null when the user has not named one, and the app derives the default from the
// repository it is pointed at. `editor` is null when files open with whatever the system associates
// with them.
export const Settings = z
  .object({
    version: z.literal(SETTINGS_VERSION),
    metabase: StoredConnection.nullable(),
    repository: RepositorySnapshot.nullable(),
    worktreeRoot: z.string().min(1).nullable(),
    editor: z.string().min(1).nullable(),
    providers: z.record(ProviderKind, ProviderPreference),
    theme: ThemePreference,
    layout: PanelLayout,
    agents: AgentDefaults,
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

// A layout from before the file tree had a width of its own.
const PanelLayoutV5 = PanelLayout.omit({ tree: true }).strict();

export const SettingsV5 = Settings.omit({ version: true, layout: true })
  .extend({ version: z.literal(5), layout: PanelLayoutV5 })
  .strict();
export type SettingsV5 = z.infer<typeof SettingsV5>;

export const SettingsV4 = SettingsV5.omit({ version: true, agents: true })
  .extend({ version: z.literal(4) })
  .strict();
export type SettingsV4 = z.infer<typeof SettingsV4>;

export const SettingsV3 = SettingsV4.omit({ version: true, layout: true })
  .extend({ version: z.literal(3) })
  .strict();
export type SettingsV3 = z.infer<typeof SettingsV3>;

export const SettingsV2 = SettingsV3.omit({ version: true, editor: true })
  .extend({ version: z.literal(2) })
  .strict();
export type SettingsV2 = z.infer<typeof SettingsV2>;

export const SettingsV1 = SettingsV2.omit({ version: true, worktreeRoot: true })
  .extend({ version: z.literal(1) })
  .strict();
export type SettingsV1 = z.infer<typeof SettingsV1>;

// A file with no `version` is generation zero: a theme and nothing else this app reads.
const SettingsV0 = z
  .object({
    theme: ThemePreference.optional(),
  })
  .loose();
export type SettingsV0 = z.infer<typeof SettingsV0>;

export const StoredSettings = z.union([
  Settings,
  SettingsV5,
  SettingsV4,
  SettingsV3,
  SettingsV2,
  SettingsV1,
  SettingsV0,
]);
export type StoredSettings = z.infer<typeof StoredSettings>;

export const ThemeRequest = z.object({ theme: ThemePreference }).strict();
export type ThemeRequest = z.infer<typeof ThemeRequest>;

// An empty path asks for the default back, which is the only way the field has to say "no choice".
export const WorktreeRootRequest = z.object({ path: z.string() }).strict();
export type WorktreeRootRequest = z.infer<typeof WorktreeRootRequest>;

// An empty command asks for the system's own association back.
export const EditorRequest = z.object({ command: z.string() }).strict();
export type EditorRequest = z.infer<typeof EditorRequest>;

export const SettingsView = z
  .object({
    theme: Theme,
    themePreference: ThemePreference,
    repository: RepositorySnapshot.nullable(),
    worktreeRoot: z.string().min(1),
    editor: z.string().min(1).nullable(),
    layout: PanelLayout,
    agents: AgentDefaults,
  })
  .strict();
export type SettingsView = z.infer<typeof SettingsView>;

const RepositoryChosen = z.object({ kind: z.literal("chosen"), settings: SettingsView }).strict();

const RepositoryPickerDismissed = z.object({ kind: z.literal("cancelled") }).strict();

const RepositoryRejected = z
  .object({ kind: z.literal("rejected"), message: z.string().min(1) })
  .strict();

export const RepositoryChoice = z.discriminatedUnion("kind", [
  RepositoryChosen,
  RepositoryPickerDismissed,
  RepositoryRejected,
]);
export type RepositoryChoice = z.infer<typeof RepositoryChoice>;
