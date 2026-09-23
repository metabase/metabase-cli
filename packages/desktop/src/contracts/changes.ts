import { z } from "zod";

export const FileChange = z.enum(["added", "modified", "deleted", "renamed"]);
export type FileChange = z.infer<typeof FileChange>;

// `previousPath` names where a renamed file came from and is null for every other change. A binary
// file has no line counts, so `added` and `removed` are zero and `binary` says why.
export const DiffFile = z
  .object({
    path: z.string().min(1),
    previousPath: z.string().min(1).nullable(),
    change: FileChange,
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    binary: z.boolean(),
  })
  .strict();
export type DiffFile = z.infer<typeof DiffFile>;

const ScopeAll = z.object({ kind: z.literal("all") }).strict();

const ScopeTurn = z.object({ kind: z.literal("turn"), turnId: z.string().min(1) }).strict();

export const ChangeScope = z.discriminatedUnion("kind", [ScopeAll, ScopeTurn]);
export type ChangeScope = z.infer<typeof ChangeScope>;

// `hunks` is git's three lines of context; `file` widens every hunk to the whole file, which is what
// expanding the context shows.
export const DiffContext = z.enum(["hunks", "file"]);
export type DiffContext = z.infer<typeof DiffContext>;

export const ChangesRequest = z
  .object({
    sessionId: z.string().min(1),
    scope: ChangeScope,
    ignoreWhitespace: z.boolean(),
    context: DiffContext,
  })
  .strict();
export type ChangesRequest = z.infer<typeof ChangesRequest>;

// `from` is the checkpoint the diff starts at, which is also where reverting one of its files goes.
export const ChangeSet = z
  .object({
    from: z.string().min(1),
    files: z.array(DiffFile),
    patch: z.string(),
  })
  .strict();
export type ChangeSet = z.infer<typeof ChangeSet>;

export const RevertRequest = z
  .object({
    sessionId: z.string().min(1),
    ref: z.string().min(1),
    path: z.string().min(1),
    previousPath: z.string().min(1).nullable(),
  })
  .strict();
export type RevertRequest = z.infer<typeof RevertRequest>;

// A file in a session's checkout, by its path from the checkout's root.
export const FileRef = z.object({ sessionId: z.string().min(1), path: z.string().min(1) }).strict();
export type FileRef = z.infer<typeof FileRef>;

const ActionDone = z.object({ kind: z.literal("done") }).strict();

const ActionRefused = z.object({ kind: z.literal("refused"), message: z.string().min(1) }).strict();

export const ActionOutcome = z.discriminatedUnion("kind", [ActionDone, ActionRefused]);
export type ActionOutcome = z.infer<typeof ActionOutcome>;

export const Divergence = z
  .object({
    against: z.string().min(1),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
  })
  .strict();
export type Divergence = z.infer<typeof Divergence>;

const PullRequestReady = z.object({ kind: z.literal("ready"), url: z.string().min(1) }).strict();

const PullRequestUnavailable = z
  .object({ kind: z.literal("unavailable"), reason: z.string().min(1) })
  .strict();

export const PullRequestTarget = z.discriminatedUnion("kind", [
  PullRequestReady,
  PullRequestUnavailable,
]);
export type PullRequestTarget = z.infer<typeof PullRequestTarget>;

const UpstreamNone = z.object({ kind: z.literal("none") }).strict();

// The branch tracks a remote branch that the remote has since deleted, so nothing says how far
// apart the two are.
const UpstreamGone = z.object({ kind: z.literal("gone"), name: z.string().min(1) }).strict();

const UpstreamTracking = z.object({ kind: z.literal("tracking"), divergence: Divergence }).strict();

export const Upstream = z.discriminatedUnion("kind", [
  UpstreamNone,
  UpstreamGone,
  UpstreamTracking,
]);
export type Upstream = z.infer<typeof Upstream>;

// `branch` is null on a detached HEAD, and `base` is null when the checkout names no branch to
// compare against. `ownBranch` is true only for a branch the app created, which is the one branch
// it will ever force-push.
export const BranchStatus = z
  .object({
    branch: z.string().min(1).nullable(),
    upstream: Upstream,
    base: Divergence.nullable(),
    clean: z.boolean(),
    ownBranch: z.boolean(),
    pullRequest: PullRequestTarget,
  })
  .strict();
export type BranchStatus = z.infer<typeof BranchStatus>;

export const CommitRequest = z
  .object({ sessionId: z.string().min(1), message: z.string().trim().min(1) })
  .strict();
export type CommitRequest = z.infer<typeof CommitRequest>;

export const PushMode = z.enum(["plain", "force-with-lease"]);
export type PushMode = z.infer<typeof PushMode>;

export const PushRequest = z.object({ sessionId: z.string().min(1), mode: PushMode }).strict();
export type PushRequest = z.infer<typeof PushRequest>;

export const OutputChunk = z.object({ sessionId: z.string().min(1), text: z.string() }).strict();
export type OutputChunk = z.infer<typeof OutputChunk>;

const PullRequestOpened = z.object({ kind: z.literal("opened"), url: z.string().min(1) }).strict();

export const PullRequestOutcome = z.discriminatedUnion("kind", [PullRequestOpened, ActionRefused]);
export type PullRequestOutcome = z.infer<typeof PullRequestOutcome>;

export const RewindRequest = z
  .object({
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    restoreFiles: z.boolean(),
  })
  .strict();
export type RewindRequest = z.infer<typeof RewindRequest>;

export const OpenedExternally = z
  .object({ urls: z.array(z.string().min(1)), paths: z.array(z.string().min(1)) })
  .strict();
export type OpenedExternally = z.infer<typeof OpenedExternally>;
