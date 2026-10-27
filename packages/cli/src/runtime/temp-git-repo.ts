import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runProcess } from "./process";

// The helper's own git calls ignore the developer's global and system config (signing, hooks), so
// setting up a repository never prompts or fails on a developer machine.
const ISOLATED_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export interface TempGitRepo {
  path: string;
  git: (...args: string[]) => Promise<string>;
  put: (file: string, text: string) => Promise<void>;
  commitAll: (message: string) => Promise<string>;
  remove: () => Promise<void>;
}

// A throwaway repository on `main` with one commit, for tests that drive real git.
export async function createTempGitRepo(): Promise<TempGitRepo> {
  const path = await mkdtemp(join(tmpdir(), "mb-ci-"));
  const git = async (...args: string[]) => {
    const result = await runProcess("git", ["-C", path, ...args], { env: ISOLATED_GIT_ENV });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    }
    return result.stdout.trim();
  };
  const put = async (file: string, text: string) => {
    await mkdir(dirname(join(path, file)), { recursive: true });
    await writeFile(join(path, file), text, "utf8");
  };
  const commitAll = async (message: string) => {
    await git("add", "-A");
    await git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "ci@example.com");
  await git("config", "user.name", "ci");
  await put("README.md", "content\n");
  await commitAll("base");
  return { path, git, put, commitAll, remove: () => rm(path, { recursive: true, force: true }) };
}
