import type { RepositoryLayout, RepositorySnapshot } from "../../contracts/settings";
import { firstLine, type Git, type GitOutcome } from "../git/service";

// Metabase reads importable files from these directories only, so their presence is what tells a
// content repository from any other checkout.
const REPRESENTATION_DIRECTORIES = ["collections", "databases", "transforms", "python_libraries"];

const REMOTE_NAME = "origin";
const REMOTE_HEAD_REF = "refs/remotes/origin/HEAD";
const REMOTE_BRANCH_PREFIX = `${REMOTE_NAME}/`;
const PATH_SEPARATOR = "/";

interface RepositoryAccepted {
  readonly kind: "chosen";
  readonly repository: RepositorySnapshot;
}

interface RepositoryRefused {
  readonly kind: "rejected";
  readonly message: string;
}

export type InspectedRepository = RepositoryAccepted | RepositoryRefused;

export interface InspectRequest {
  readonly git: Git;
  readonly path: string;
}

function rejection(message: string): InspectedRepository {
  return { kind: "rejected", message };
}

type GitProblem = Exclude<GitOutcome, { kind: "answered" }>;

function failureMessage(path: string, outcome: GitProblem): string {
  return outcome.kind === "unavailable"
    ? outcome.message
    : `${path} is not a git repository.\n${outcome.message}`;
}

function layoutOf(trackedFiles: string): RepositoryLayout {
  const paths = trackedFiles.split("\n").filter((line) => line.trim().length > 0);
  if (paths.length === 0) {
    return "empty";
  }
  const roots = new Set(paths.map((file) => file.split(PATH_SEPARATOR)[0]));
  return REPRESENTATION_DIRECTORIES.some((directory) => roots.has(directory))
    ? "representation"
    : "other";
}

export async function inspectRepository(request: InspectRequest): Promise<InspectedRepository> {
  const { git, path } = request;

  const toplevel = await git.read(path, ["rev-parse", "--show-toplevel"]);
  if (toplevel.kind !== "answered") {
    return rejection(failureMessage(path, toplevel));
  }
  const root = firstLine(toplevel.stdout);
  if (root === null) {
    return rejection(`git named no working tree for ${path}.`);
  }

  const tracked = await git.read(path, ["ls-files"]);
  if (tracked.kind !== "answered") {
    return rejection(failureMessage(path, tracked));
  }

  const remote = await git.read(path, ["remote", "get-url", REMOTE_NAME]);
  const snapshot: RepositorySnapshot = {
    path: root,
    remote: remote.kind === "answered" ? firstLine(remote.stdout) : null,
    defaultBranch: await readDefaultBranch(git, path),
    layout: layoutOf(tracked.stdout),
  };
  return { kind: "chosen", repository: snapshot };
}

async function readDefaultBranch(git: Git, path: string): Promise<string | null> {
  const remoteHead = await git.read(path, ["symbolic-ref", "--short", REMOTE_HEAD_REF]);
  if (remoteHead.kind === "answered") {
    const named = firstLine(remoteHead.stdout);
    if (named !== null && named.startsWith(REMOTE_BRANCH_PREFIX)) {
      return named.slice(REMOTE_BRANCH_PREFIX.length);
    }
    return named;
  }
  const localHead = await git.read(path, ["symbolic-ref", "--short", "HEAD"]);
  return localHead.kind === "answered" ? firstLine(localHead.stdout) : null;
}
