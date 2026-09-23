import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { errorMessage, isFileNotFoundError } from "@metabase/client/errors";
import { EidTranslateResult } from "@metabase/client/domain/eid-translation";
import {
  SyncDirtyItem,
  SyncImportResult,
  SyncRemoteChanges,
  SyncTask,
} from "@metabase/client/domain/git-sync";

import type { ActionOutcome, OutputChunk } from "../../contracts/changes";
import type { ConnectionState } from "../../contracts/connection";
import type { SyncOutcome } from "../../contracts/events";
import { GitSyncTree } from "../../contracts/metabase";
import type {
  ContentLink,
  MetabaseEdit,
  MetabasePanelState,
  MetabaseWorktree,
  MetadataTree,
  RemoteSyncState,
  SessionContent,
  SyncRequest,
  SyncTaskSummary,
  SyncedTree,
  TransformRequest,
  TransformRunOutcome,
  TransformTestsOutcome,
} from "../../contracts/metabase";
import type { SessionSnapshot } from "../../contracts/session";
import type { MetabaseCli } from "../cli/runner";
import { GitFailure, type Git } from "../git/service";
import { presentCheckout, type SessionChanges } from "../sessions/changes";

import { readSessionContent } from "./content";
import { contentLinks, readContentEntities, translationRequest, type MetabaseSite } from "./links";
import { syncReadiness } from "./readiness";
import { runTransform, runTransformTests } from "./transforms";
import { entityPaths, nestCollections } from "./tree";
import { offersRemoteSync, type MetabaseWorktrees, type WorktreeScope } from "./worktrees";

const ORIGIN = "origin";
const GITIGNORE = ".gitignore";
const APP_DIRECTORIES = [".metadata/", ".scratch/"] as const;
const METADATA_EXPORT_SEGMENTS = [".metadata", "table_metadata.json"] as const;
const NEWLINE = "\n";
const NOT_IGNORED_EXIT = 1;

const SyncStatus = z.object({
  branch: z.string().min(1).nullable(),
  current_task: SyncTask.nullable(),
  synced_collections: z.array(z.object({ id: z.number().int(), name: z.string().min(1) }).loose()),
});

const SyncDirtyList = z.object({ data: z.array(SyncDirtyItem) }).loose();

// The panel counts every edit, so the list is read past the CLI's output cap.
const WHOLE_LIST = ["--max-bytes", "0"] as const;

const MetadataExtractResult = z.object({ tables: z.number().int() }).loose();

// A session's checkout and the CLI that reaches Metabase for it, inside its worktree when it has one.
interface SessionScope extends WorktreeScope {
  readonly cwd: string;
}

interface LoopDeps {
  readonly git: Git;
  readonly worktrees: MetabaseWorktrees;
  readonly changes: SessionChanges;
  readonly open: (sessionId: string) => Promise<SessionSnapshot>;
  readonly connection: () => ConnectionState;
  readonly recordSync: (sessionId: string, branch: string, outcome: SyncOutcome) => Promise<void>;
  readonly publish: (output: OutputChunk) => void;
  readonly log: (message: string) => void;
}

function taskSummary(task: SyncTask | null): SyncTaskSummary | null {
  if (task === null) {
    return null;
  }
  const message = task.error_message ?? null;
  return {
    kind: task.sync_task_type,
    status: task.status,
    progress: task.progress,
    endedAt: task.ended_at ?? null,
    message: message === null || message.length === 0 ? null : message,
  };
}

function editOf(item: SyncDirtyItem): MetabaseEdit {
  const name = item.name === null || item.name.length === 0 ? null : item.name;
  return { id: item.id, name, model: item.model };
}

function siteOf(connection: ConnectionState, worktree: MetabaseWorktree): MetabaseSite | null {
  return connection.kind === "disconnected" ? null : { url: connection.url, worktree };
}

function importSummary(result: SyncImportResult): string {
  if (result.task_id === null) {
    return result.message ?? "Nothing new to import.";
  }
  return `Import task #${result.task_id} succeeded.`;
}

function refused(message: string): ActionOutcome {
  return { kind: "refused", message };
}

// Sync, metadata and the ignore file are all read from the session's own checkout, which for a
// worktree session is not the repository the user picked.
export class MetabaseLoop {
  private readonly syncing = new Set<string>();

  constructor(private readonly deps: LoopDeps) {}

  async panel(sessionId: string): Promise<MetabasePanelState> {
    const { cwd, cli, worktree } = await this.scope(sessionId);
    const [status, remote, remoteSync, metadata, unignored] = await Promise.all([
      this.deps.changes.status(sessionId),
      this.deps.git.read(cwd, ["remote", "get-url", ORIGIN]),
      this.remoteSync(cli, cwd),
      this.metadataTree(cwd),
      this.unignored(cwd),
    ]);
    const readiness = syncReadiness({
      connection: this.deps.connection(),
      branch: status,
      hasRemote: remote.kind === "answered",
      trackedBranch: remoteSync.kind === "read" ? remoteSync.branch : null,
    });
    return { worktree, remoteSync, readiness, metadata, unignored };
  }

  async content(sessionId: string): Promise<SessionContent> {
    const { cwd, cli, worktree } = await this.scope(sessionId);
    const changed = await this.deps.changes.files(sessionId);
    return readSessionContent(
      { git: this.deps.git, cli, log: this.deps.log },
      {
        cwd,
        changed,
        site: siteOf(this.deps.connection(), worktree),
      },
    );
  }

  async tree(sessionId: string): Promise<SyncedTree> {
    if (!offersRemoteSync(this.deps.connection())) {
      return { kind: "off" };
    }
    const { cwd, cli } = await this.scope(sessionId);
    const [listed, paths] = await Promise.all([
      cli.run(cwd, ["git-sync", "tree", ...WHOLE_LIST], GitSyncTree),
      entityPaths(cwd),
    ]);
    if (listed.kind === "failed") {
      return { kind: "unavailable", message: listed.message };
    }
    return { kind: "read", collections: nestCollections(listed.value.collections, paths) };
  }

  async runTransform(request: TransformRequest): Promise<TransformRunOutcome> {
    const { cwd, cli } = await this.scope(request.sessionId);
    return runTransform(cli, cwd, request.transformId);
  }

  async runTransformTests(request: TransformRequest): Promise<TransformTestsOutcome> {
    const { cwd, cli } = await this.scope(request.sessionId);
    return runTransformTests(cli, cwd, request.transformId);
  }

  async sync(request: SyncRequest): Promise<ActionOutcome> {
    if (this.syncing.has(request.sessionId)) {
      return refused("This session is already syncing.");
    }
    this.syncing.add(request.sessionId);
    try {
      return await this.runSync(request);
    } finally {
      this.syncing.delete(request.sessionId);
    }
  }

  async refreshMetadata(sessionId: string): Promise<ActionOutcome> {
    const { cwd, cli } = await this.scope(sessionId);
    const extracted = await cli.run(cwd, ["metadata", "extract"], MetadataExtractResult);
    return extracted.kind === "failed" ? refused(extracted.message) : { kind: "done" };
  }

  async ignoreAppDirectories(sessionId: string): Promise<ActionOutcome> {
    const cwd = await this.checkout(sessionId);
    const missing = await this.unignored(cwd);
    if (missing.length === 0) {
      return { kind: "done" };
    }
    const path = join(cwd, GITIGNORE);
    const existing = await readIfPresent(path);
    const separator = existing === null || existing.endsWith(NEWLINE) ? "" : NEWLINE;
    await appendFile(path, `${separator}${missing.join(NEWLINE)}${NEWLINE}`, "utf8");
    return { kind: "done" };
  }

  private async runSync(request: SyncRequest): Promise<ActionOutcome> {
    const state = await this.panel(request.sessionId);
    const readiness = state.readiness;
    if (readiness.kind === "blocked") {
      return refused(readiness.reason);
    }
    if (readiness.guard !== null && !request.confirmedGuard) {
      return refused(readiness.guard);
    }
    const say = (text: string): void => {
      this.deps.publish({ sessionId: request.sessionId, text });
    };
    if (readiness.push) {
      say(`$ git push origin ${readiness.branch}\n`);
      const pushed = await this.deps.changes.pushStreaming(
        { sessionId: request.sessionId, mode: "plain" },
        say,
      );
      if (pushed.kind === "refused") {
        return this.finish(request.sessionId, readiness.branch, pushed.message, say);
      }
    }
    const scope = await this.scope(request.sessionId);
    const args = ["git-sync", "import", "--branch", readiness.branch];
    say(`$ mb ${args.join(" ")}\n`);
    const imported = await scope.cli.run(scope.cwd, args, SyncImportResult);
    if (imported.kind === "failed") {
      return this.finish(request.sessionId, readiness.branch, imported.message, say);
    }
    say(`${importSummary(imported.value)}\n`);
    const links = await this.importedLinks(request.sessionId, scope);
    await this.deps.recordSync(request.sessionId, readiness.branch, { kind: "imported", links });
    return { kind: "done" };
  }

  private async finish(
    sessionId: string,
    branch: string,
    message: string,
    say: (text: string) => void,
  ): Promise<ActionOutcome> {
    say(`${message}\n`);
    await this.deps.recordSync(sessionId, branch, { kind: "failed", message });
    return refused(message);
  }

  // The import already succeeded, so a link that cannot be resolved is logged and left out rather
  // than turning a synced branch into a failed sync.
  private async importedLinks(
    sessionId: string,
    { cwd, cli, worktree }: SessionScope,
  ): Promise<ContentLink[]> {
    const site = siteOf(this.deps.connection(), worktree);
    if (site === null) {
      return [];
    }
    try {
      const changed = await this.deps.changes.files(sessionId);
      const paths = changed.files.filter((file) => file.change !== "deleted").map((f) => f.path);
      const entities = await readContentEntities(cwd, paths);
      if (entities.length === 0) {
        return [];
      }
      const body = JSON.stringify(translationRequest(entities));
      const translated = await cli.run(cwd, ["eid", "--body", body], EidTranslateResult);
      if (translated.kind === "failed") {
        this.deps.log(
          `sync ${sessionId}: the imported content has no links: ${translated.message}`,
        );
        return [];
      }
      return contentLinks(site, entities, translated.value);
    } catch (error) {
      this.deps.log(`sync ${sessionId}: the imported content has no links: ${errorMessage(error)}`);
      return [];
    }
  }

  private async remoteSync(cli: MetabaseCli, cwd: string): Promise<RemoteSyncState> {
    const connection = this.deps.connection();
    if (!offersRemoteSync(connection)) {
      return { kind: "off" };
    }
    const [status, dirty, remote] = await Promise.all([
      cli.run(cwd, ["git-sync", "status"], SyncStatus),
      cli.run(cwd, ["git-sync", "dirty", ...WHOLE_LIST], SyncDirtyList),
      cli.run(cwd, ["git-sync", "has-remote-changes"], SyncRemoteChanges),
    ]);
    if (status.kind === "failed") {
      return { kind: "unavailable", message: status.message };
    }
    if (dirty.kind === "failed") {
      return { kind: "unavailable", message: dirty.message };
    }
    if (remote.kind === "failed") {
      return { kind: "unavailable", message: remote.message };
    }
    return {
      kind: "read",
      branch: status.value.branch,
      edits: dirty.value.data.map(editOf),
      remoteChanges: remote.value.has_changes,
      task: taskSummary(status.value.current_task),
      collectionCount: status.value.synced_collections.length,
    };
  }

  private async metadataTree(cwd: string): Promise<MetadataTree> {
    try {
      const exported = await stat(join(cwd, ...METADATA_EXPORT_SEGMENTS));
      return { kind: "present", extractedAt: exported.mtime.toISOString() };
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return { kind: "absent" };
      }
      throw error;
    }
  }

  // `--no-index` asks what the rules say, so a directory that does not exist yet still answers.
  private async unignored(cwd: string): Promise<string[]> {
    const missing: string[] = [];
    for (const directory of APP_DIRECTORIES) {
      const checked = await this.deps.git.read(cwd, [
        "check-ignore",
        "-q",
        "--no-index",
        directory,
      ]);
      if (checked.kind === "refused" && checked.code === NOT_IGNORED_EXIT) {
        missing.push(directory);
      } else if (checked.kind !== "answered") {
        throw new GitFailure(checked.message);
      }
    }
    return missing;
  }

  private async checkout(sessionId: string): Promise<string> {
    return presentCheckout(await this.deps.open(sessionId));
  }

  private async scope(sessionId: string): Promise<SessionScope> {
    const snapshot = await this.deps.open(sessionId);
    const cwd = await presentCheckout(snapshot);
    return { cwd, ...(await this.deps.worktrees.scope(snapshot.session)) };
  }
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}
