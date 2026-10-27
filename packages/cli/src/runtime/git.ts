import { AbortError, ConfigError, InternalError } from "@metabase/client/errors";

import {
  ProcessInterruptedError,
  ProcessNotFoundError,
  ProcessTimeoutError,
  runProcess,
  runProcessBinary,
} from "./process";

const GIT = "git";
const NO_MATCH_EXIT_CODE = 1;
const NO_MERGE_BASE_EXIT_CODE = 1;
const UNKNOWN_REF_EXIT_CODE = 1;
// Generous for a large repository; a git call past it is hung, e.g. on a stuck fsmonitor hook.
const GIT_TIMEOUT_MS = 120_000;

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function withGit<T>(
  repo: string,
  args: readonly string[],
  spawn: () => Promise<T>,
): Promise<T> {
  try {
    return await spawn();
  } catch (error) {
    if (error instanceof ProcessNotFoundError) {
      throw new ConfigError("git is not installed or not on PATH");
    }
    if (error instanceof ProcessInterruptedError) {
      throw new AbortError(`interrupted while git ${args.join(" ")} ran in ${repo}`);
    }
    if (error instanceof ProcessTimeoutError) {
      throw new ConfigError(
        `git ${args.join(" ")} did not finish within ${GIT_TIMEOUT_MS / 1000} s in ${repo}`,
      );
    }
    throw error;
  }
}

function runGit(repo: string, args: readonly string[], signal: AbortSignal): Promise<GitResult> {
  return withGit(repo, args, () =>
    runProcess(GIT, ["-C", repo, ...args], { signal, timeoutMs: GIT_TIMEOUT_MS }),
  );
}

async function git(repo: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  const result = await runGit(repo, args, signal);
  if (result.exitCode !== 0) {
    throw new ConfigError(`git ${args.join(" ")} failed in ${repo}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export async function repositoryRoot(repo: string, signal: AbortSignal): Promise<string> {
  const result = await runGit(repo, ["rev-parse", "--show-toplevel"], signal);
  if (result.exitCode !== 0) {
    throw new ConfigError(`--repo ${repo} is not inside a git work tree: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function resolveCommit(
  repo: string,
  ref: string,
  flag: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
    signal,
  );
  if (result.exitCode === UNKNOWN_REF_EXIT_CODE) {
    throw new ConfigError(`${flag} ${ref} is not a commit in ${repo}`);
  }
  if (result.exitCode !== 0) {
    throw new ConfigError(`git rev-parse failed in ${repo}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

// The checked-out commit, or null on an unborn branch, which has none.
export async function checkedOutCommit(repo: string, signal: AbortSignal): Promise<string | null> {
  const result = await runGit(repo, ["rev-parse", "--verify", "--quiet", "HEAD"], signal);
  if (result.exitCode === UNKNOWN_REF_EXIT_CODE) {
    return null;
  }
  if (result.exitCode !== 0) {
    throw new ConfigError(`git rev-parse HEAD failed in ${repo}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function mergeBase(
  repo: string,
  base: string,
  head: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await runGit(repo, ["merge-base", base, head], signal);
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

export function diffNameStatus(
  repo: string,
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<string> {
  return git(repo, ["diff", "--name-status", "-z", "-M", from, to], signal);
}

export function statusPorcelain(repo: string, signal: AbortSignal): Promise<string> {
  return git(repo, ["status", "--porcelain", "-z", "--untracked-files=all"], signal);
}

// `git ls-tree -z` writes `<mode> <type> <object>\t<path>` per entry.
export async function fileModesAt(
  repo: string,
  commit: string,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const output = await git(repo, ["ls-tree", "-r", "-z", "--full-tree", commit], signal);
  const modes = new Map<string, string>();
  for (const record of output.split("\0")) {
    if (record === "") {
      continue;
    }
    const space = record.indexOf(" ");
    const tab = record.indexOf("\t");
    if (space === -1 || tab < space) {
      throw new InternalError(`git ls-tree -z: malformed entry "${record}"`);
    }
    modes.set(record.slice(tab + 1), record.slice(0, space));
  }
  return modes;
}

export async function filesMatching(
  repo: string,
  commit: string,
  pattern: string,
  pathspecs: readonly string[],
  signal: AbortSignal,
): Promise<string[]> {
  // --no-color: a user's color.grep=always would wrap paths in escape codes, even through a pipe.
  const result = await runGit(
    repo,
    ["grep", "--no-color", "-z", "-l", "-E", "-e", pattern, commit, "--", ...pathspecs],
    signal,
  );
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

const NEWLINE = 0x0a;
const utf8 = new TextDecoder("utf-8");

// Reads every path at a commit in one `git cat-file --batch`, which frames each object as
// `<sha> blob <size>\n<bytes>\n`. A path that is not a blob at the commit is an error: callers ask
// only for paths git itself just listed.
export async function readFilesAt(
  repo: string,
  commit: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  if (paths.length === 0) {
    return files;
  }
  const multiline = paths.find((path) => path.includes("\n"));
  if (multiline !== undefined) {
    throw new ConfigError(
      `cannot read ${JSON.stringify(multiline)}: a path with a newline cannot be batched`,
    );
  }
  const args = ["cat-file", "--batch"];
  const result = await withGit(repo, args, () =>
    runProcessBinary(GIT, ["-C", repo, ...args], {
      stdin: paths.map((path) => `${commit}:${path}\n`).join(""),
      signal,
      timeoutMs: GIT_TIMEOUT_MS,
    }),
  );
  if (result.exitCode !== 0) {
    throw new ConfigError(`git cat-file --batch failed in ${repo}: ${result.stderr.trim()}`);
  }
  const output = result.stdout;
  let offset = 0;
  for (const path of paths) {
    const headerEnd = output.indexOf(NEWLINE, offset);
    if (headerEnd === -1) {
      throw new InternalError(`git cat-file --batch stopped before ${path}`);
    }
    const header = utf8.decode(output.subarray(offset, headerEnd)).split(" ");
    const size = Number(header[2]);
    if (header[1] !== "blob" || !Number.isInteger(size)) {
      throw new InternalError(`${path} is not a file at ${commit}, though git listed it there`);
    }
    const start = headerEnd + 1;
    if (output[start + size] !== NEWLINE) {
      throw new InternalError(
        `git cat-file --batch framed ${path} with ${size} bytes, but no newline follows them`,
      );
    }
    files.set(path, utf8.decode(output.subarray(start, start + size)));
    offset = start + size + 1;
  }
  if (offset !== output.length) {
    throw new InternalError("git cat-file --batch printed more than the paths it was asked for");
  }
  return files;
}
