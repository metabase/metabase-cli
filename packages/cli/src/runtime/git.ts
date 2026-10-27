import { ConfigError, InternalError } from "@metabase/client/errors";

import { ProcessNotFoundError, runProcess, runProcessBinary } from "./process";

const GIT = "git";
const NO_MATCH_EXIT_CODE = 1;
const NO_MERGE_BASE_EXIT_CODE = 1;
const UNKNOWN_REF_EXIT_CODE = 1;

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function withGit<T>(spawn: () => Promise<T>): Promise<T> {
  try {
    return await spawn();
  } catch (error) {
    if (error instanceof ProcessNotFoundError) {
      throw new ConfigError("git is not installed or not on PATH");
    }
    throw error;
  }
}

function runGit(repo: string, args: readonly string[]): Promise<GitResult> {
  return withGit(() => runProcess(GIT, ["-C", repo, ...args]));
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

// `git ls-tree -z` writes `<mode> <type> <object>\t<path>` per entry.
export async function fileModesAt(repo: string, commit: string): Promise<Map<string, string>> {
  const output = await git(repo, ["ls-tree", "-r", "-z", "--full-tree", commit]);
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
): Promise<string[]> {
  // --no-color: a user's color.grep=always would wrap paths in escape codes, even through a pipe.
  const result = await runGit(repo, [
    "grep",
    "--no-color",
    "-z",
    "-l",
    "-E",
    "-e",
    pattern,
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

const NEWLINE = 0x0a;
const utf8 = new TextDecoder("utf-8");

// Reads every path at a commit in one `git cat-file --batch`, which frames each object as
// `<sha> blob <size>\n<bytes>\n`. A path that is not a blob at the commit is an error: callers ask
// only for paths git itself just listed.
export async function readFilesAt(
  repo: string,
  commit: string,
  paths: readonly string[],
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
  const result = await withGit(() =>
    runProcessBinary(GIT, ["-C", repo, "cat-file", "--batch"], {
      stdin: paths.map((path) => `${commit}:${path}\n`).join(""),
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
