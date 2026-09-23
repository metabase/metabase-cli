import type { Divergence, Upstream } from "../../contracts/changes";

import { GitFailure, gitText, nulFields, type Git } from "./service";

const HEADER_PREFIX = "# ";
const DETACHED_HEAD = "(detached)";
const AHEAD_BEHIND = /^\+(\d+) -(\d+)$/;
const LEFT_RIGHT_COUNT = /^(\d+)\s+(\d+)$/;
const RENAME_ENTRY = "2 ";

// `branch` is null on a detached HEAD.
interface PorcelainStatus {
  readonly branch: string | null;
  readonly upstream: Upstream;
  readonly clean: boolean;
}

interface Headers {
  head: string | null;
  upstream: string | null;
  aheadBehind: string | null;
}

function readHeader(headers: Headers, line: string): void {
  const [key, ...rest] = line.slice(HEADER_PREFIX.length).split(" ");
  const value = rest.join(" ");
  if (key === "branch.head") {
    headers.head = value;
  } else if (key === "branch.upstream") {
    headers.upstream = value;
  } else if (key === "branch.ab") {
    headers.aheadBehind = value;
  }
}

// git names an upstream the remote deleted but prints no ahead/behind line for it.
function upstreamOf(headers: Headers): Upstream {
  if (headers.upstream === null) {
    return { kind: "none" };
  }
  if (headers.aheadBehind === null) {
    return { kind: "gone", name: headers.upstream };
  }
  const [, ahead, behind] = AHEAD_BEHIND.exec(headers.aheadBehind) ?? [];
  if (ahead === undefined || behind === undefined) {
    throw new GitFailure(
      `git printed an ahead/behind header it does not document: ${headers.aheadBehind}`,
    );
  }
  return {
    kind: "tracking",
    divergence: { against: headers.upstream, ahead: Number(ahead), behind: Number(behind) },
  };
}

// Reads `git status --porcelain=v2 --branch -z`. A rename entry carries its original path as one
// more NUL-separated field, which is skipped rather than counted as a second change.
export function parsePorcelainStatus(stdout: string): PorcelainStatus {
  const headers: Headers = { head: null, upstream: null, aheadBehind: null };
  let entries = 0;
  const fields = nulFields(stdout);
  let index = 0;
  while (index < fields.length) {
    const field = fields[index];
    if (field === undefined) {
      break;
    }
    if (field.startsWith(HEADER_PREFIX)) {
      readHeader(headers, field);
      index += 1;
      continue;
    }
    entries += 1;
    index += field.startsWith(RENAME_ENTRY) ? 2 : 1;
  }
  const branch = headers.head === null || headers.head === DETACHED_HEAD ? null : headers.head;
  return { branch, upstream: upstreamOf(headers), clean: entries === 0 };
}

const ORIGIN_REMOTE = "origin";

export async function readPorcelainStatus(git: Git, cwd: string): Promise<PorcelainStatus> {
  const outcome = await git.read(cwd, ["status", "--porcelain=v2", "--branch", "-z"]);
  return parsePorcelainStatus(gitText(outcome));
}

// A pull request and a sync compare against what origin holds, so the base is origin's copy of it
// whenever this clone has one; a repository with no such remote-tracking ref compares locally.
export async function comparisonBase(git: Git, cwd: string, base: string): Promise<string> {
  const remote = `${ORIGIN_REMOTE}/${base}`;
  const outcome = await git.read(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/${remote}`,
  ]);
  return outcome.kind === "answered" ? remote : base;
}

// `rev-list --left-right --count base...branch` prints what only the base has, then what only the
// branch has: how far behind, then how far ahead. A base that names no commit has no answer.
export async function readDivergence(
  git: Git,
  cwd: string,
  base: string,
  branch: string,
): Promise<Divergence | null> {
  const outcome = await git.read(cwd, [
    "rev-list",
    "--left-right",
    "--count",
    `${base}...${branch}`,
  ]);
  if (outcome.kind === "refused") {
    return null;
  }
  const stdout = gitText(outcome);
  const [, behind, ahead] = LEFT_RIGHT_COUNT.exec(stdout.trim()) ?? [];
  if (behind === undefined || ahead === undefined) {
    throw new GitFailure(`git printed a left-right count it does not document: ${stdout}`);
  }
  return { against: base, ahead: Number(ahead), behind: Number(behind) };
}
