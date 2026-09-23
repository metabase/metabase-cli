import type { SessionIndexEntry } from "../contracts/session";

export interface SessionFilter {
  readonly query: string;
  readonly archived: boolean;
}

function matches(entry: SessionIndexEntry, query: string): boolean {
  if (query.length === 0) {
    return true;
  }
  const wanted = query.toLowerCase();
  const branch =
    entry.workspace.kind === "worktree" ? entry.workspace.branch : entry.workspace.path;
  return entry.title.toLowerCase().includes(wanted) || branch.toLowerCase().includes(wanted);
}

function order(left: SessionIndexEntry, right: SessionIndexEntry): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function visibleSessions(
  sessions: readonly SessionIndexEntry[],
  filter: SessionFilter,
): readonly SessionIndexEntry[] {
  const lifecycle = filter.archived ? "archived" : "active";
  return sessions
    .filter((entry) => entry.lifecycle === lifecycle && matches(entry, filter.query))
    .toSorted(order);
}

export function archivedCount(sessions: readonly SessionIndexEntry[]): number {
  return sessions.filter((entry) => entry.lifecycle === "archived").length;
}
