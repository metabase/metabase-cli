import { join } from "node:path";

import type { RepositorySnapshot } from "../../contracts/settings";
import { branchSlug } from "../sessions/naming";

const DEFAULT_ROOT_SEGMENTS = ["metabase-rde", "worktrees"];
const PATH_SEPARATOR = "/";

export interface WorktreeRootRequest {
  readonly configured: string | null;
  readonly repository: RepositorySnapshot | null;
  readonly homeDirectory: string;
}

export function projectSlug(path: string): string {
  const segments = path.split(PATH_SEPARATOR).filter((segment) => segment.length > 0);
  return branchSlug(segments[segments.length - 1] ?? path);
}

export function resolveWorktreeRoot(request: WorktreeRootRequest): string {
  if (request.configured !== null) {
    return request.configured;
  }
  const base = join(request.homeDirectory, ...DEFAULT_ROOT_SEGMENTS);
  if (request.repository === null) {
    return base;
  }
  return join(base, projectSlug(request.repository.path));
}
