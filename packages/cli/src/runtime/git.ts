import { ConfigError, InternalError } from "@metabase/client/errors";

import { ProcessNotFoundError, runProcess } from "./process";

const GIT = "git";
const NO_MATCH_EXIT_CODE = 1;
const NO_MERGE_BASE_EXIT_CODE = 1;
const UNKNOWN_REF_EXIT_CODE = 1;

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function runGit(repo: string, args: readonly string[]): Promise<GitResult> {
  try {
    return await runProcess(GIT, ["-C", repo, ...args]);
  } catch (error) {
    if (error instanceof ProcessNotFoundError) {
      throw new ConfigError("git is not installed or not on PATH");
    }
    throw error;
  }
}

async function git(repo: string, args: readonly string[]): Promise<string> {
  const result = await runGit(repo, args);
  if (result.exitCode !== 0) {
    throw new ConfigError(`git ${args.join(" ")} failed in ${repo}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export async function repositoryRoot(repo: string): Promise<string> {
  const result = await runGit(repo, ["rev-parse", "--show-toplevel"]);
  if (result.exitCode !== 0) {
    throw new ConfigError(`--repo ${repo} is not inside a git work tree: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function resolveCommit(repo: string, ref: string, flag: string): Promise<string> {
  const result = await runGit(repo, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${ref}^{commit}`,
  ]);
  if (result.exitCode === UNKNOWN_REF_EXIT_CODE) {
    throw new ConfigError(`${flag} ${ref} is not a commit in ${repo}`);
  }
  if (result.exitCode !== 0) {
    throw new ConfigError(`git rev-parse failed in ${repo}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

// The checked-out commit, or null on an unborn branch, which has none.
export async function checkedOutCommit(repo: string): Promise<string | null> {
  const result = await runGit(repo, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (result.exitCode === UNKNOWN_REF_EXIT_CODE) {
    return null;
  }
  if (result.exitCode !== 0) {
    throw new ConfigError(`git rev-parse HEAD failed in ${repo}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function mergeBase(repo: string, base: string, head: string): Promise<string> {
  const result = await runGit(repo, ["merge-base", base, head]);
  if (result.exitCode === NO_MERGE_BASE_EXIT_CODE) {
    throw new ConfigError(
      `--base and --head share no history in ${repo}: the clone may be shallow (fetch the full history, e.g. actions/checkout with fetch-depth: 0), or the histories are unrelated`,
    );
  }
  if (result.exitCode !== 0) {
    throw new ConfigError(`git merge-base failed in ${repo}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function diffNameStatus(repo: string, from: string, to: string): Promise<string> {
  return git(repo, ["diff", "--name-status", "-z", "-M", from, to]);
}

export function statusPorcelain(repo: string): Promise<string> {
  return git(repo, ["status", "--porcelain", "-z", "--untracked-files=all"]);
}

export function readFileAt(repo: string, commit: string, path: string): Promise<string> {
  return git(repo, ["cat-file", "blob", `${commit}:${path}`]);
}

export async function filesContaining(
  repo: string,
  commit: string,
  text: string,
  pathspecs: readonly string[],
): Promise<string[]> {
  // --no-color: a user's color.grep=always would wrap paths in escape codes, even through a pipe.
  const result = await runGit(repo, [
    "grep",
    "--no-color",
    "-z",
    "-l",
    "-F",
    "-e",
    text,
    commit,
    "--",
    ...pathspecs,
  ]);
  if (result.exitCode === NO_MATCH_EXIT_CODE) {
    return [];
  }
  if (result.exitCode !== 0) {
    throw new ConfigError(`git grep failed in ${repo}: ${result.stderr.trim()}`);
  }
  const prefix = `${commit}:`;
  return result.stdout
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => {
      if (!entry.startsWith(prefix)) {
        throw new InternalError(`git grep printed "${entry}", which does not start with ${prefix}`);
      }
      return entry.slice(prefix.length);
    });
}
