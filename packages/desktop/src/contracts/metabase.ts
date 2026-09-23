import { z } from "zod";

import { FileChange } from "./changes";

// What a content file holds, named the way Metabase names it to a person: a card is a question, a
// model or a metric by its `type`.
export const EntityKind = z.enum([
  "action",
  "channel",
  "collection",
  "dashboard",
  "database",
  "document",
  "field",
  "glossary",
  "measure",
  "metabot",
  "metric",
  "model",
  "python-library",
  "question",
  "segment",
  "snippet",
  "table",
  "timeline",
  "transform",
  "transform-job",
  "transform-tag",
]);
export type EntityKind = z.infer<typeof EntityKind>;

// The kinds Metabase gives a page of its own, so a synced one can be opened there.
export const ContentKind = EntityKind.extract([
  "collection",
  "dashboard",
  "document",
  "metric",
  "model",
  "question",
  "transform",
]);
export type ContentKind = z.infer<typeof ContentKind>;

export const ContentLink = z
  .object({
    kind: ContentKind,
    title: z.string().min(1),
    url: z.string().min(1),
  })
  .strict();
export type ContentLink = z.infer<typeof ContentLink>;

export const SyncTaskStatus = z.enum([
  "running",
  "successful",
  "errored",
  "timed-out",
  "conflict",
  "cancelled",
]);
export type SyncTaskStatus = z.infer<typeof SyncTaskStatus>;

// `progress` is the server's fraction done, null when it has not reported one; `endedAt` is null
// while the task runs.
export const SyncTaskSummary = z
  .object({
    kind: z.enum(["import", "export"]),
    status: SyncTaskStatus,
    progress: z.number().min(0).max(1).nullable(),
    endedAt: z.string().min(1).nullable(),
    message: z.string().min(1).nullable(),
  })
  .strict();
export type SyncTaskSummary = z.infer<typeof SyncTaskSummary>;

// An object someone changed in Metabase that the tracked branch does not hold yet. Metabase leaves
// some of them unnamed.
export const MetabaseEdit = z
  .object({
    id: z.number().int(),
    name: z.string().min(1).nullable(),
    model: z.string().min(1),
  })
  .strict();
export type MetabaseEdit = z.infer<typeof MetabaseEdit>;

// `branch` is the instance's `remote-sync-branch`, null when the instance tracks none.
// `remoteChanges` says the remote branch holds commits Metabase has not imported.
// `collectionCount` is how many collections the instance syncs.
const RemoteSyncRead = z
  .object({
    kind: z.literal("read"),
    branch: z.string().min(1).nullable(),
    edits: z.array(MetabaseEdit),
    remoteChanges: z.boolean(),
    task: SyncTaskSummary.nullable(),
    collectionCount: z.number().int().nonnegative(),
  })
  .strict();

const RemoteSyncUnavailable = z
  .object({ kind: z.literal("unavailable"), message: z.string().min(1) })
  .strict();

// The instance does not offer remote sync, so nothing was asked of it.
const RemoteSyncOff = z.object({ kind: z.literal("off") }).strict();

export const RemoteSyncState = z.discriminatedUnion("kind", [
  RemoteSyncRead,
  RemoteSyncUnavailable,
  RemoteSyncOff,
]);
export type RemoteSyncState = z.infer<typeof RemoteSyncState>;

const SyncBlocked = z.object({ kind: z.literal("blocked"), reason: z.string().min(1) }).strict();

// `push` says the branch goes to the remote first. `guard` is the warning a person confirms before
// the branch replaces what the instance tracks, and null when the branch is not that one.
const SyncReady = z
  .object({
    kind: z.literal("ready"),
    branch: z.string().min(1),
    push: z.boolean(),
    guard: z.string().min(1).nullable(),
  })
  .strict();

export const SyncReadiness = z.discriminatedUnion("kind", [SyncBlocked, SyncReady]);
export type SyncReadiness = z.infer<typeof SyncReadiness>;

// What `mb git-sync worktree ensure --json` prints: the one worktree Metabase keeps for the branch.
export const WorktreeEnsured = z
  .object({ id: z.number().int().positive(), branch: z.string().min(1) })
  .loose();

// The worktree a session's requests to Metabase run in. `absent` is an instance without remote sync
// or a session with no branch yet; `failed` sends the session's requests to the main app, with the
// CLI's reason.
const WorktreeAbsent = z.object({ kind: z.literal("absent") }).strict();

const WorktreeReady = z
  .object({ kind: z.literal("ready"), id: z.number().int().positive(), branch: z.string().min(1) })
  .strict();

const WorktreeFailed = z.object({ kind: z.literal("failed"), message: z.string().min(1) }).strict();

export const MetabaseWorktree = z.discriminatedUnion("kind", [
  WorktreeAbsent,
  WorktreeReady,
  WorktreeFailed,
]);
export type MetabaseWorktree = z.infer<typeof MetabaseWorktree>;

const WORKTREE_PARAM = "worktree";
const QUERY_MARK = "?";
const HASH_MARK = "#";

interface SplitUrl {
  readonly path: string;
  readonly query: string;
  readonly hash: string;
}

function splitUrl(url: string): SplitUrl {
  const hashAt = url.indexOf(HASH_MARK);
  const head = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const queryAt = head.indexOf(QUERY_MARK);
  if (queryAt === -1) {
    return { path: head, query: "", hash };
  }
  return { path: head.slice(0, queryAt), query: head.slice(queryAt + 1), hash };
}

// Every Metabase page a session opens names the session's worktree in its `worktree` parameter, and
// one without a worktree is the main app's page.
export function worktreeUrl(url: string, worktree: MetabaseWorktree): string {
  if (worktree.kind !== "ready") {
    return url;
  }
  const { path, query, hash } = splitUrl(url);
  const params = new URLSearchParams(query);
  params.set(WORKTREE_PARAM, String(worktree.id));
  return `${path}${QUERY_MARK}${params.toString()}${hash}`;
}

// `unignored` lists the app's own directories the checkout's `.gitignore` does not cover yet.
export const MetabasePanelState = z
  .object({
    worktree: MetabaseWorktree,
    remoteSync: RemoteSyncState,
    readiness: SyncReadiness,
    unignored: z.array(z.string().min(1)),
  })
  .strict();
export type MetabasePanelState = z.infer<typeof MetabasePanelState>;

export const SyncRequest = z
  .object({
    sessionId: z.string().min(1),
    confirmedGuard: z.boolean(),
  })
  .strict();
export type SyncRequest = z.infer<typeof SyncRequest>;

const ContentEntity = z.object({ kind: EntityKind, name: z.string().min(1) }).strict();
export type ContentEntity = z.infer<typeof ContentEntity>;

// `pointer` is the JSON pointer into the file the representation schema refused.
const ValidationIssue = z.object({ pointer: z.string(), message: z.string().min(1) }).strict();

const ContentValid = z.object({ kind: z.literal("valid") }).strict();

const ContentInvalid = z
  .object({ kind: z.literal("invalid"), issues: z.array(ValidationIssue).min(1) })
  .strict();

const ContentUnchecked = z
  .object({ kind: z.literal("unchecked"), reason: z.string().min(1) })
  .strict();

export const ContentValidation = z.discriminatedUnion("kind", [
  ContentValid,
  ContentInvalid,
  ContentUnchecked,
]);
export type ContentValidation = z.infer<typeof ContentValidation>;

const TransformRunStatus = z.enum([
  "started",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "canceling",
]);

// `at` is when the run ended, or when it started while it still runs.
export const TransformRunSummary = z
  .object({
    status: TransformRunStatus,
    at: z.string().min(1),
    message: z.string().min(1).nullable(),
  })
  .strict();
export type TransformRunSummary = z.infer<typeof TransformRunSummary>;

// A transform's last run, null when it never ran or the run cannot be read.
export const TransformLastRun = TransformRunSummary.nullable();

const TransformInMetabase = z
  .object({
    id: z.number().int().positive(),
    lastRun: TransformRunSummary.nullable(),
  })
  .strict();

// `entity` is null for a file that names no object Metabase knows. A deleted file has nothing to
// validate, so its `validation` is null. `url` is the object's page, null while Metabase does not
// hold it or when its kind has no page. `transform` is set for a transform Metabase holds.
export const ContentItem = z
  .object({
    path: z.string().min(1),
    change: FileChange,
    entity: ContentEntity.nullable(),
    validation: ContentValidation.nullable(),
    url: z.string().min(1).nullable(),
    transform: TransformInMetabase.nullable(),
  })
  .strict();
export type ContentItem = z.infer<typeof ContentItem>;

export const SessionContent = z.object({ items: z.array(ContentItem) }).strict();
export type SessionContent = z.infer<typeof SessionContent>;

export const TransformRequest = z
  .object({
    sessionId: z.string().min(1),
    transformId: z.number().int().positive(),
  })
  .strict();
export type TransformRequest = z.infer<typeof TransformRequest>;

const Refused = z.object({ kind: z.literal("refused"), message: z.string().min(1) }).strict();

const TransformRan = z.object({ kind: z.literal("ran"), run: TransformRunSummary }).strict();

export const TransformRunOutcome = z.discriminatedUnion("kind", [TransformRan, Refused]);
export type TransformRunOutcome = z.infer<typeof TransformRunOutcome>;

// `failing` names the expectations that did not pass, in the order the test declares them.
export const TransformTestResult = z
  .object({
    name: z.string().min(1),
    status: z.enum(["passed", "failed"]),
    failing: z.array(z.string()),
  })
  .strict();
export type TransformTestResult = z.infer<typeof TransformTestResult>;

const TransformTestsRan = z
  .object({ kind: z.literal("ran"), tests: z.array(TransformTestResult) })
  .strict();

export const TransformTestsOutcome = z.discriminatedUnion("kind", [TransformTestsRan, Refused]);
export type TransformTestsOutcome = z.infer<typeof TransformTestsOutcome>;

// What `mb git-sync tree --json` prints: every collection the instance syncs, flat, each with the
// items it holds directly, and the transforms when the instance syncs them, their collections flat
// the same way beside the transforms in none. `parent_id` is a synced parent's id, null for a root.
const GitSyncTreeItem = z
  .object({
    id: z.number().int(),
    entity_id: z.string().min(1),
    name: z.string().min(1),
    model: z.string().min(1),
  })
  .loose();
export type GitSyncTreeItem = z.infer<typeof GitSyncTreeItem>;

const GitSyncTreeCollection = z
  .object({
    id: z.number().int(),
    entity_id: z.string().min(1),
    name: z.string().min(1),
    parent_id: z.number().int().nullable(),
    items: z.array(GitSyncTreeItem),
  })
  .loose();
export type GitSyncTreeCollection = z.infer<typeof GitSyncTreeCollection>;

const GitSyncTreeTransforms = z
  .object({ collections: z.array(GitSyncTreeCollection), items: z.array(GitSyncTreeItem) })
  .loose();
export type GitSyncTreeTransforms = z.infer<typeof GitSyncTreeTransforms>;

export const GitSyncTree = z
  .object({
    collections: z.array(GitSyncTreeCollection),
    transforms: GitSyncTreeTransforms.nullable(),
  })
  .loose();

// `path` is the checkout's file that holds the item, null when no file there carries its entity id.
export const SyncedItem = z
  .object({
    id: z.number().int(),
    entityId: z.string().min(1),
    name: z.string().min(1),
    model: z.string().min(1),
    path: z.string().min(1).nullable(),
  })
  .strict();
export type SyncedItem = z.infer<typeof SyncedItem>;

// Built strict from the start: `.strict()` would read the shape, and with it the recursive getter,
// before the constant exists.
export const SyncedCollection = z.strictObject({
  id: z.number().int(),
  entityId: z.string().min(1),
  name: z.string().min(1),
  get collections() {
    return z.array(SyncedCollection);
  },
  items: z.array(SyncedItem),
});
export type SyncedCollection = z.infer<typeof SyncedCollection>;

// The transforms Metabase syncs as one unit: their collections nested, and the transforms in none.
export const SyncedTransforms = z
  .object({ collections: z.array(SyncedCollection), items: z.array(SyncedItem) })
  .strict();
export type SyncedTransforms = z.infer<typeof SyncedTransforms>;

// `transforms` is null when the instance does not sync transforms.
const SyncedTreeRead = z
  .object({
    kind: z.literal("read"),
    collections: z.array(SyncedCollection),
    transforms: SyncedTransforms.nullable(),
  })
  .strict();

// The content the instance syncs, nested the way its collections nest.
export const SyncedTree = z.discriminatedUnion("kind", [
  SyncedTreeRead,
  RemoteSyncUnavailable,
  RemoteSyncOff,
]);
export type SyncedTree = z.infer<typeof SyncedTree>;
