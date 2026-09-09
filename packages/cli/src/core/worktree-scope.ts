import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";

import { ENV_WORKTREE } from "./env";

// How a command relates to the worktree/main-app split. `scoped` honours a resolved scope,
// `any` is indifferent to one, and `main-only` mutates or runs main-app state and so may not
// execute while a scope is in force.
export const WorktreePolicy = z.enum(["scoped", "any", "main-only"]);
export type WorktreePolicy = z.infer<typeof WorktreePolicy>;

interface WorktreeIdRef {
  kind: "id";
  id: number;
}

interface WorktreeBranchRef {
  kind: "branch";
  branch: string;
}

// What the user named, before it is known to exist: the server takes an id, so a branch ref costs
// a lookup and an id ref does not.
export type WorktreeRef = WorktreeIdRef | WorktreeBranchRef;

export interface WorktreeScope {
  id: number;
  branch: string;
}

type WorktreeScopeOrigin = "flag" | "env" | "pin";

export interface WorktreeScopeSource {
  ref: WorktreeRef;
  origin: WorktreeScopeOrigin;
  // A pin stores both halves of the scope, so a pinned source resolves without a request.
  scope: WorktreeScope | null;
}

export interface WorktreeScopeInput {
  profile: string;
  flag: string | undefined;
  env: string | undefined;
  pin: WorktreeScope | null;
}

const WORKTREE_FLAG = "--worktree";

const ORIGIN_LABEL: Readonly<Record<WorktreeScopeOrigin, string>> = Object.freeze({
  flag: WORKTREE_FLAG,
  env: ENV_WORKTREE,
  pin: "the profile pin",
});

const DIGITS = /^\d+$/;

export function parseWorktreeRef(raw: string, label: string): WorktreeRef {
  const value = raw.trim();
  if (value === "") {
    throw new ConfigError(`invalid ${label}: value must not be blank`);
  }
  if (!DIGITS.test(value)) {
    return { kind: "branch", branch: value };
  }
  const id = Number(value);
  if (id < 1) {
    throw new ConfigError(`invalid ${label}: ${value} (must be ≥ 1)`);
  }
  return { kind: "id", id };
}

export function formatWorktreeRef(ref: WorktreeRef): string {
  return ref.kind === "id" ? String(ref.id) : `"${ref.branch}"`;
}

// A pin is a lock rather than a default: a harness hands an agent a config home holding one pinned
// profile, and a flag or env var that could point somewhere else would undo the isolation the pin
// exists to provide. Re-stating the same worktree is allowed, so a script may be explicit.
export function resolveScopeSource(input: WorktreeScopeInput): WorktreeScopeSource | null {
  const stated = statedRef(input);
  if (stated === null) {
    return input.pin === null
      ? null
      : { ref: { kind: "id", id: input.pin.id }, origin: "pin", scope: input.pin };
  }
  const pin = input.pin;
  if (pin === null) {
    return { ...stated, scope: null };
  }
  if (!refMatchesScope(stated.ref, pin)) {
    throw new ConfigError(
      `profile "${input.profile}" is pinned to worktree ${pin.id} (${pin.branch}); ` +
        `refusing ${ORIGIN_LABEL[stated.origin]} ${formatWorktreeRef(stated.ref)}`,
    );
  }
  return { ...stated, scope: pin };
}

export function describeScopeSource(source: WorktreeScopeSource): string {
  const subject =
    source.scope === null
      ? `worktree ${formatWorktreeRef(source.ref)}`
      : `worktree ${source.scope.id} (${source.scope.branch})`;
  return `${subject} from ${ORIGIN_LABEL[source.origin]}`;
}

export function mainOnlyRefusal(command: string, source: WorktreeScopeSource): string {
  return (
    `${command} is not available inside a worktree (scope: ${describeScopeSource(source)}); ` +
    `it changes main-app content. Unpin the profile (\`mb worktree unpin\`) or drop ${ENV_WORKTREE} ` +
    `to run it against the main app.`
  );
}

interface StatedRef {
  ref: WorktreeRef;
  origin: WorktreeScopeOrigin;
}

function statedRef(input: WorktreeScopeInput): StatedRef | null {
  if (input.flag !== undefined && input.flag !== "") {
    return { ref: parseWorktreeRef(input.flag, WORKTREE_FLAG), origin: "flag" };
  }
  if (input.env !== undefined && input.env !== "") {
    return { ref: parseWorktreeRef(input.env, ENV_WORKTREE), origin: "env" };
  }
  return null;
}

function refMatchesScope(ref: WorktreeRef, scope: WorktreeScope): boolean {
  return ref.kind === "id" ? ref.id === scope.id : ref.branch === scope.branch;
}
