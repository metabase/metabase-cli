import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import {
  Collection,
  SyncDirtyItem,
  SyncDirtyItemCompact,
  SyncTask,
  SyncTaskCompact,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import { assertCapabilities, type ToolCapabilities } from "./capability";
import type { MetabaseToolDeps } from "./deps";
import { pollUntil, resolveTimeoutMs, resolveWait, timeoutMsParam, waitParam } from "./poll";
import { readSkillsFirst, type SkillName } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, type TextToolResult } from "./tool-result";

export const GIT_SYNC_CAPABILITIES: ToolCapabilities = {
  minVersion: 60,
  tokenFeature: "remote_sync",
};

const TOOL_NAME = "git_sync";
const SKILLS: readonly SkillName[] = ["git-sync"];

const PATHS = {
  currentTask: "/api/ee/remote-sync/current-task",
  isDirty: "/api/ee/remote-sync/is-dirty",
  hasRemoteChanges: "/api/ee/remote-sync/has-remote-changes",
  dirty: "/api/ee/remote-sync/dirty",
  import: "/api/ee/remote-sync/import",
  export: "/api/ee/remote-sync/export",
  stash: "/api/ee/remote-sync/stash",
  branches: "/api/ee/remote-sync/branches",
  createBranch: "/api/ee/remote-sync/create-branch",
  settings: "/api/ee/remote-sync/settings",
  branchSetting: "/api/setting/remote-sync-branch",
} as const;

const TERMINAL_STATUSES = new Set(["successful", "errored", "cancelled", "timed-out", "conflict"]);
const FAILURE_STATUSES = new Set(["errored", "timed-out", "conflict"]);
const NO_CONTENT = 204;

const ACTIONS = [
  "status",
  "import",
  "export",
  "stash",
  "branches",
  "create_branch",
  "add_collection",
  "remove_collection",
] as const;
type Action = (typeof ACTIONS)[number];

const IsDirtyResult = z.object({ is_dirty: z.boolean() });
const HasRemoteChangesResult = z.object({
  has_changes: z.boolean(),
  remote_version: z.string().nullable(),
  local_version: z.string().nullable(),
});
const DirtyResult = z.object({ dirty: z.array(SyncDirtyItem) });
const BranchesResult = z.object({ items: z.array(z.string()) });
const CreateBranchResult = z.object({ status: z.literal("success"), message: z.string() });
const SettingsUpdateResult = z.object({
  success: z.boolean(),
  task_id: z.number().int().positive().optional(),
});
const ImportKickoff = z.object({
  task_id: z.number().int().positive().nullable(),
  message: z.string().nullable().optional(),
});
const TaskKickoff = z.object({
  message: z.string(),
  task_id: z.number().int().positive(),
});
const CollectionList = z.array(Collection);
const BranchSetting = z.string().nullable();

const parameters = Type.Object({
  action: Type.Unsafe<Action>({
    type: "string",
    enum: [...ACTIONS],
    description:
      "`status` — branch, dirty state, the running task and whether the remote is ahead, in one call · `import` the remote's content into Metabase · `export` Metabase's changes to the remote · `stash` the current state onto a fresh branch · `branches` on the remote · `create_branch` and switch to it · `add_collection` / `remove_collection` to change what is synced.",
  }),
  branch: Type.Optional(
    Type.String({
      description:
        "`import` / `export`: the branch to work against. Defaults to the instance's configured `remote-sync-branch`, which `status` reports.",
    }),
  ),
  message: Type.Optional(Type.String({ description: "`export` / `stash`: the commit message." })),
  new_branch: Type.Optional(
    Type.String({ description: "`stash`: the branch to create and export onto. Required." }),
  ),
  name: Type.Optional(Type.String({ description: "`create_branch`: the branch name. Required." })),
  collection_id: Type.Optional(
    Type.Integer({
      description:
        "`add_collection` / `remove_collection`: the collection whose sync state changes. It cascades to descendants.",
    }),
  ),
  force: Type.Optional(
    Type.Boolean({
      description:
        "LOSSY, default `false`. On `import` it discards Metabase's uncommitted local changes — the dirty items `status` lists are gone for good. On `export` it force-pushes, overwriting the remote branch's history. Never set it to clear a conflict without the user saying which side wins.",
    }),
  ),
  wait: waitParam,
  timeout_ms: timeoutMsParam,
});

export function gitSyncTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    label: "Git sync",
    description:
      `${readSkillsFirst(SKILLS)}\n\n` +
      "Move Metabase content between this instance and its git remote. Content lives in git as files and in Metabase as entities; `export` writes Metabase's state out, `import` reads the remote's state in, and only the collections marked for sync travel either way.\n\n" +
      'Start with `status`: it answers where the branch is, whether Metabase has local changes the remote does not have, whether the remote has changes Metabase does not have, and what is running — the four facts every other action depends on.\n\nExamples: `{action: "status"}` · `{action: "export", message: "Add finance dashboards"}` · `{action: "import", branch: "main"}`',
    parameters,
    execute: (_id, params) => runGitSyncTool(deps, params),
  });
}

type GitSyncParams = Static<typeof parameters>;

export function runGitSyncTool(
  deps: MetabaseToolDeps,
  params: GitSyncParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertCapabilities(deps.instance, GIT_SYNC_CAPABILITIES, TOOL_NAME);
    return await run(deps, params);
  });
}

async function run(deps: MetabaseToolDeps, params: GitSyncParams): Promise<TextToolResult> {
  const { client } = deps;
  switch (params.action) {
    case "status": {
      return await status(client);
    }
    case "import": {
      return await runImport(client, params);
    }
    case "export": {
      return await runExport(client, params);
    }
    case "stash": {
      return await runStash(client, params);
    }
    case "branches": {
      const branches = await client.requestParsed(BranchesResult, PATHS.branches);
      return jsonResult(`${String(branches.items.length)} branches on the remote`, branches.items);
    }
    case "create_branch": {
      const name = requireText(params.name, "create_branch", "name", "the branch to create");
      const created = await client.requestParsed(CreateBranchResult, PATHS.createBranch, {
        method: "POST",
        body: { name },
      });
      return jsonResult(
        `created branch "${name}" and switched git-sync to it — from here, \`export\` writes to it`,
        created,
      );
    }
    case "add_collection": {
      return await setCollectionSynced(client, params, true);
    }
    case "remove_collection": {
      return await setCollectionSynced(client, params, false);
    }
  }
}

interface SyncStatus {
  branch: string | null;
  is_dirty: boolean;
  dirty_items: unknown[];
  remote_has_changes: boolean;
  remote_version: string | null;
  local_version: string | null;
  current_task: unknown;
  synced_collections: SyncedCollection[];
}

interface SyncedCollection {
  id: number;
  name: string;
}

async function status(client: Client): Promise<TextToolResult> {
  const [branch, dirty, dirtyItems, remote, task, collections] = await Promise.all([
    fetchOptional(client, PATHS.branchSetting, BranchSetting),
    client.requestParsed(IsDirtyResult, PATHS.isDirty),
    client.requestParsed(DirtyResult, PATHS.dirty),
    client.requestParsed(HasRemoteChangesResult, PATHS.hasRemoteChanges),
    fetchCurrentTask(client),
    client.requestParsed(CollectionList, "/api/collection"),
  ]);

  const value: SyncStatus = {
    branch,
    is_dirty: dirty.is_dirty,
    dirty_items: dirtyItems.dirty.map((item) => SyncDirtyItemCompact.parse(item)),
    remote_has_changes: remote.has_changes,
    remote_version: remote.remote_version,
    local_version: remote.local_version,
    current_task: task === null ? null : SyncTaskCompact.parse(task),
    synced_collections: syncedCollections(collections),
  };
  return jsonResult(summarize(value), value);
}

// The personal-collection root reports a string id ("root"), which no sync setting can name.
function syncedCollections(collections: readonly Collection[]): SyncedCollection[] {
  const synced: SyncedCollection[] = [];
  for (const collection of collections) {
    if (collection.is_remote_synced === true && typeof collection.id === "number") {
      synced.push({ id: collection.id, name: collection.name });
    }
  }
  return synced;
}

function summarize(current: SyncStatus): string {
  const branch = current.branch === null ? "no branch configured" : `branch ${current.branch}`;
  const local = current.is_dirty
    ? `${String(current.dirty_items.length)} local changes not yet exported`
    : "no local changes";
  const remote = current.remote_has_changes
    ? "the remote is ahead and has changes not yet imported"
    : "the remote is not ahead";
  return `git-sync on ${branch} — ${local}, ${remote}`;
}

async function runImport(client: Client, params: GitSyncParams): Promise<TextToolResult> {
  const kickoff = await client.requestParsed(ImportKickoff, PATHS.import, {
    method: "POST",
    body: syncBody(params),
  });
  if (kickoff.task_id === null) {
    return jsonResult(kickoff.message ?? "already up to date; nothing to import", {
      imported: false,
      message: kickoff.message ?? null,
    });
  }
  return await settle(client, params, kickoff.task_id, "import");
}

async function runExport(client: Client, params: GitSyncParams): Promise<TextToolResult> {
  const kickoff = await client.requestParsed(TaskKickoff, PATHS.export, {
    method: "POST",
    body: syncBody(params),
  });
  return await settle(client, params, kickoff.task_id, "export");
}

async function runStash(client: Client, params: GitSyncParams): Promise<TextToolResult> {
  const newBranch = requireText(
    params.new_branch,
    "stash",
    "new_branch",
    "the branch to create and export the current state onto",
  );
  const kickoff = await client.requestParsed(TaskKickoff, PATHS.stash, {
    method: "POST",
    body: { new_branch: newBranch, message: params.message ?? `Stashed from ${TOOL_NAME}` },
  });
  return await settle(client, params, kickoff.task_id, `stash onto "${newBranch}"`);
}

interface SyncRequestBody {
  branch?: string;
  message?: string;
  force?: boolean;
}

function syncBody(params: GitSyncParams): SyncRequestBody {
  const body: SyncRequestBody = {};
  if (params.branch !== undefined && params.branch !== "") {
    body.branch = params.branch;
  }
  if (params.message !== undefined && params.message !== "") {
    body.message = params.message;
  }
  if (params.force === true) {
    body.force = true;
  }
  return body;
}

async function settle(
  client: Client,
  params: GitSyncParams,
  taskId: number,
  verb: string,
): Promise<TextToolResult> {
  if (!resolveWait(params.wait)) {
    return jsonResult(`started ${verb} task ${String(taskId)}`, { task_id: taskId });
  }

  const final = await pollUntil(
    async () => fetchCurrentTask(client),
    (task) => task === null || TERMINAL_STATUSES.has(task.status),
    {
      timeoutMs: resolveTimeoutMs(params.timeout_ms),
      subject: `The ${verb} task ${String(taskId)}`,
      recheck: `{action: "status"}`,
    },
  );
  if (final === null) {
    return jsonResult(`${verb} task ${String(taskId)} finished`, { task_id: taskId });
  }
  if (FAILURE_STATUSES.has(final.status)) {
    throw failedTask(final, verb);
  }
  return jsonResult(`${verb} task ${String(taskId)} succeeded`, SyncTaskCompact.parse(final));
}

function failedTask(task: SyncTask, verb: string): TeachingError {
  const message = task.error_message ?? null;
  const detail = message === null ? "" : ` ${message}`;
  if (task.status !== "conflict") {
    return new TeachingError(`The ${verb} task ${String(task.id)} ${task.status}.${detail}`);
  }
  const conflicts = task.conflicts ?? [];
  const listed = conflicts.length === 0 ? "" : ` Conflicting: ${conflicts.join(", ")}.`;
  return new TeachingError(
    `The ${verb} task ${String(task.id)} hit conflicts — the same content changed on both sides.${listed} Resolving one means discarding the other side's version, so ask the user which side wins before using \`force\`.`,
  );
}

async function setCollectionSynced(
  client: Client,
  params: GitSyncParams,
  synced: boolean,
): Promise<TextToolResult> {
  const collectionId = params.collection_id;
  if (collectionId === undefined) {
    throw new TeachingError(`\`${params.action}\` needs \`collection_id\`.`);
  }
  const result = await client.requestParsed(SettingsUpdateResult, PATHS.settings, {
    method: "PUT",
    body: { collections: { [String(collectionId)]: synced } },
  });
  const verb = synced ? "is now git-synced" : "is no longer git-synced";
  return jsonResult(
    `collection ${String(collectionId)} ${verb}, along with its descendants`,
    result,
  );
}

async function fetchCurrentTask(client: Client): Promise<SyncTask | null> {
  return await fetchOptional(client, PATHS.currentTask, SyncTask);
}

// The remote-sync endpoints answer "nothing here" with 204 and an empty body, which is not JSON and
// would fail a parse — the absence is the answer, so it becomes null rather than an error.
async function fetchOptional<T>(
  client: Client,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const response = await client.requestRaw(path, { method: "GET", expectContentType: "binary" });
  if (response.status === NO_CONTENT) {
    return null;
  }
  const text = await response.text();
  if (text.trim() === "") {
    return null;
  }
  return schema.parse(JSON.parse(text));
}

function requireText(
  value: string | undefined,
  action: string,
  field: string,
  what: string,
): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    throw new TeachingError(`\`${action}\` needs \`${field}\` — ${what}.`);
  }
  return trimmed;
}
