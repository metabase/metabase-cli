import { stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { z } from "zod";

import { resolveLicenseToken } from "../../core/config";
import {
  type BindMount,
  CONTAINER_REPO_DIR,
  checkDockerReady,
  containerLifecycleStatus,
  containerNameFor,
  pullImage,
  removeContainer,
  runWorkspaceContainer,
  scrubContainerConfig,
  waitForConfigConsumed,
} from "../../core/docker";
import { ConfigError, errorMessage } from "../../core/errors";
import { type Client, createClient } from "../../core/http/client";
import { probeHealth } from "../../core/http/probe";
import { localUrl } from "../../core/url";
import {
  REPO_SYNC_MODES,
  type RepoSettings,
  RepoSyncMode,
  type WorkspaceCredentials,
  buildCredentialsJson,
  generateWorkspaceCredentials,
  injectCredentialsIntoConfig,
  injectRepoSettingsIntoConfig,
} from "../../core/workspace-credentials";
import type { ResourceView } from "../../domain/view";
import { Workspace } from "../../domain/workspace";
import { warn } from "../../output/notice";
import { renderItem } from "../../output/render";
import { findFreePort, isPortFree } from "../../runtime/port";
import { pollUntil } from "../../runtime/poll";
import { runProcess } from "../../runtime/process";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { parseInteger, parseOptionalInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

const DEFAULT_IMAGE = "metabase/metabase-dev:feature-workspaces-v2";
const DEFAULT_HOST_PORT = 3000;
// 240s: a cold boot (image pull + JVM classloading + initial app-db migrations)
// can exceed three minutes on the first start.
const DEFAULT_READY_TIMEOUT_MS = 240_000;
const HEALTH_INTERVAL_MS = 2_000;
const HEALTH_MAX_INTERVAL_MS = 10_000;
const HEALTH_PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_REPO_MODE: RepoSyncMode = "read-write";
const REPO_FILE_URL = `file://${CONTAINER_REPO_DIR}`;
// The POST spools the multi-MB body to a temp file synchronously before
// returning 202, so the 30s default is too tight; reuse the readiness budget
// for both the upload and the subsequent status poll.
const METADATA_IMPORT_TIMEOUT_MS = DEFAULT_READY_TIMEOUT_MS;
const METADATA_POLL_INTERVAL_MS = 250;
const METADATA_POLL_MAX_INTERVAL_MS = 5_000;

const MetadataImportEnqueued = z.object({
  queued: z.literal(true),
  "import-id": z.string(),
});

const MetadataImportStatus = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "ok", "error"]),
  "enqueued-at": z.string(),
  "started-at": z.string().nullable(),
  "finished-at": z.string().nullable(),
  "wall-ms": z.number().nullable(),
  error: z.string().nullable(),
});

export const StartResult = z.object({
  workspace_id: z.number().int().positive(),
  workspace_name: z.string(),
  container_name: z.string(),
  state: z.enum(["running", "starting"]),
  host_port: z.number().int().positive(),
  url: z.string(),
  image: z.string(),
});
export type StartResult = z.infer<typeof StartResult>;

const startResultView: ResourceView<StartResult> = {
  compactPick: StartResult.pick({
    workspace_id: true,
    workspace_name: true,
    state: true,
    url: true,
  }).strip(),
  tableColumns: [
    { key: "workspace_id", label: "ID" },
    { key: "workspace_name", label: "Name" },
    { key: "state", label: "State" },
    { key: "url", label: "URL" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "start",
    description: "Start a local Docker container that serves as the workspace's dev instance",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Workspace id", required: true },
    port: {
      type: "string",
      description: `Host port to bind (default: ${DEFAULT_HOST_PORT}; auto-shifts up when this flag is omitted, fails on collision when set explicitly)`,
    },
    image: {
      type: "string",
      description: `Docker image to run (default: ${DEFAULT_IMAGE})`,
      default: DEFAULT_IMAGE,
    },
    wait: {
      type: "boolean",
      description:
        "Block until /api/health is ready before returning. Default: return as soon as the container has consumed config.yml. (Implied when --metadata is on, since the import requires a live API.)",
      default: false,
    },
    timeout: {
      type: "string",
      description: `Per-phase readiness deadline in ms — covers post-create config consumption, (with --wait) the /api/health probe, and (with --metadata) the metadata-import status poll. Default: ${DEFAULT_READY_TIMEOUT_MS}.`,
      default: String(DEFAULT_READY_TIMEOUT_MS),
    },
    pull: {
      type: "boolean",
      description: "Pull the image before starting",
      default: true,
    },
    metadata: {
      type: "boolean",
      description:
        "Fetch the workspace's warehouse metadata from the parent and POST it to the child instance once it is healthy",
      default: true,
    },
    force: {
      type: "boolean",
      description:
        "Remove and recreate the container even if it is running. Stopped containers (exited/created/dead) are recreated automatically without this flag.",
      default: false,
    },
    repo: {
      type: "string",
      description: `Bind-mount a host directory (typically a remote-sync git repo) into the container at ${CONTAINER_REPO_DIR}. Sets remote-sync-url=${REPO_FILE_URL} in the workspace config.yml so the child boots already wired to the repo.`,
    },
    "repo-branch": {
      type: "string",
      description:
        "Branch to set as remote-sync-branch (default: the current branch of the host repo, read from HEAD)",
    },
    "repo-mode": {
      type: "string",
      description: "remote-sync-type: 'read-write' (default) or 'read-only'",
      default: DEFAULT_REPO_MODE,
    },
  },
  outputSchema: StartResult,
  examples: [
    "metabase workspace start 1",
    "metabase workspace start 1 --wait",
    "metabase workspace start 1 --port 3100",
    "metabase workspace start 1 --image metabase/metabase-dev:feature-workspaces-v2 --no-pull",
    "metabase workspace start 1 --force",
    "metabase workspace start 1 --repo /path/to/sync-repo --wait",
    "metabase workspace start 1 --repo /path/to/sync-repo --repo-branch dev --repo-mode read-only",
  ],
  async run({ args, ctx, getClient, getResolvedConfig }) {
    const workspaceId = parseId(args.id);
    const containerName = containerNameFor(workspaceId);
    const requestedPort = parseOptionalInteger(args.port, { name: "--port", min: 1 });
    const readyTimeoutMs = parseInteger(args.timeout ?? String(DEFAULT_READY_TIMEOUT_MS), {
      name: "--timeout",
      min: 1000,
    });
    const client = await getClient();
    const resolved = await getResolvedConfig();
    const licenseToken = await resolveLicenseToken({});

    await checkDockerReady();
    await ensureNoExistingContainer(workspaceId, containerName, args.force);

    const pullPromise = args.pull ? pullImage(args.image) : Promise.resolve();

    const workspace = await client.requestParsed(
      Workspace,
      `/api/ee/workspace-manager/${workspaceId}`,
    );
    assertAllDatabasesProvisioned(workspace);

    const hostPort = await resolveHostPort(requestedPort);

    // Boot bundle stays in process memory: no host-disk artifact for config.yml
    // or credentials.json. The bytes are tar-streamed into the container by the
    // docker daemon and land on the overlay FS (root-only on the daemon host).
    // Repo resolution overlaps with the parent fetches.
    const [parentConfigYaml, metadataJson, repoOptions] = await Promise.all([
      fetchConfigYaml(client, workspaceId),
      args.metadata ? fetchMetadataJson(client, workspaceId) : Promise.resolve(null),
      resolveRepoOptions({
        hostPath: args.repo,
        branch: args["repo-branch"],
        mode: args["repo-mode"],
      }),
    ]);

    const credentials = generateWorkspaceCredentials(workspaceId);
    const configWithCredentials = injectCredentialsIntoConfig(parentConfigYaml, credentials);
    const configYaml =
      repoOptions !== null
        ? injectRepoSettingsIntoConfig(configWithCredentials, repoOptions.repo)
        : configWithCredentials;
    const credentialsJson = buildCredentialsJson(credentials);

    await pullPromise;

    await runWorkspaceContainer({
      workspaceId,
      workspaceName: workspace.name,
      profile: resolved.profile,
      parentUrl: resolved.url,
      image: args.image,
      hostPort,
      configYaml,
      credentialsJson,
      licenseToken,
      bindMounts: repoOptions === null ? [] : [repoOptions.bindMount],
    });

    // The child reads config.yml during init; once it logs the consumed marker, the
    // warehouse credentials inside that file are mirrored into its app db and the
    // file itself is no longer needed. Scrubbing it here keeps the warehouse password
    // out of the container's overlay FS for the rest of the instance's lifetime.
    // credentials.json stays — `workspace credentials` reads it on demand.
    await waitForConfigConsumed(workspaceId, readyTimeoutMs);
    try {
      await scrubContainerConfig(workspaceId);
    } catch (error) {
      warn(`could not scrub in-container config.yml: ${errorMessage(error)}`);
    }

    // The metadata POST lands at the child's REST API, so the child must be
    // health-ready before we can ship it. That implicitly upgrades --wait when
    // --metadata is on.
    const needsHealth = args.wait || metadataJson !== null;
    if (needsHealth) {
      await waitForHealth(hostPort, readyTimeoutMs);
    }
    if (metadataJson !== null) {
      await importMetadataIntoChild(hostPort, credentials, metadataJson, readyTimeoutMs);
    }

    const result: StartResult = {
      workspace_id: workspaceId,
      workspace_name: workspace.name,
      container_name: containerName,
      state: needsHealth ? "running" : "starting",
      host_port: hostPort,
      url: localUrl(hostPort),
      image: args.image,
    };
    renderItem(result, startResultView, ctx);
  },
});

function assertAllDatabasesProvisioned(workspace: Workspace): void {
  const databases = workspace.databases ?? [];
  if (databases.length === 0) {
    throw new ConfigError(
      `workspace ${workspace.id} has no databases — provision at least one before starting`,
    );
  }
  const unready = databases.filter((entry) => entry.status !== "provisioned");
  if (unready.length > 0) {
    const summary = unready
      .map((entry) => `database ${entry.database_id}=${entry.status}`)
      .join(", ");
    throw new ConfigError(
      `workspace ${workspace.id} is not ready: ${summary}. Wait for provisioning to finish.`,
    );
  }
}

async function ensureNoExistingContainer(
  workspaceId: number,
  containerName: string,
  force: boolean,
): Promise<void> {
  if (force) {
    await removeContainer(containerName);
    return;
  }
  const status = await containerLifecycleStatus(containerName);
  if (status === "missing") {
    return;
  }
  // The container exists but isn't running — the workspace is unused, so recreate
  // transparently. The named app-db volume persists across rm/create, so workspace
  // state is preserved; recreating also picks up any new flags (--port, --image,
  // --repo) and refreshes the boot bundle.
  if (status === "exited" || status === "created" || status === "dead") {
    await removeContainer(containerName);
    return;
  }
  throw new ConfigError(
    `container ${containerName} is currently ${status}. Run \`metabase workspace stop ${workspaceId}\` first, or use --force to recreate it.`,
  );
}

async function resolveHostPort(requested: number | null): Promise<number> {
  if (requested !== null) {
    if (!(await isPortFree(requested))) {
      throw new ConfigError(`port ${requested} is already in use`);
    }
    return requested;
  }
  if (await isPortFree(DEFAULT_HOST_PORT)) {
    return DEFAULT_HOST_PORT;
  }
  return findFreePort(DEFAULT_HOST_PORT + 1);
}

async function fetchConfigYaml(client: Client, workspaceId: number): Promise<string> {
  const response = await client.requestRaw(`/api/ee/workspace-manager/${workspaceId}/config`, {
    expectContentType: "binary",
  });
  return response.text();
}

async function fetchMetadataJson(client: Client, workspaceId: number): Promise<Uint8Array> {
  const response = await client.requestRaw(
    `/api/ee/workspace-manager/${workspaceId}/metadata/export`,
    {
      expectContentType: "binary",
      query: { "with-databases": true, "with-tables": true, "with-fields": true },
    },
  );
  return new Uint8Array(await response.arrayBuffer());
}

async function waitForHealth(hostPort: number, timeoutMs: number): Promise<void> {
  const url = `${localUrl(hostPort)}/api/health`;
  await pollUntil(
    () => probeHealth(url, HEALTH_PROBE_TIMEOUT_MS),
    (probe) => probe.ready,
    {
      intervalMs: HEALTH_INTERVAL_MS,
      maxIntervalMs: HEALTH_MAX_INTERVAL_MS,
      backoff: "exponential",
      timeoutMs,
    },
  );
}

async function importMetadataIntoChild(
  hostPort: number,
  credentials: WorkspaceCredentials,
  metadataJson: Uint8Array,
  pollTimeoutMs: number,
): Promise<void> {
  const childClient = createClient({
    url: localUrl(hostPort),
    apiKey: credentials.api_key.key,
  });
  const enqueued = await childClient.requestParsed(
    MetadataImportEnqueued,
    "/api/ee/serialization/metadata/import",
    {
      method: "POST",
      body: metadataJson,
      timeoutMs: METADATA_IMPORT_TIMEOUT_MS,
    },
  );
  const importId = enqueued["import-id"];
  const final = await pollUntil(
    () =>
      childClient.requestParsed(
        MetadataImportStatus,
        `/api/ee/serialization/metadata/import/${importId}`,
      ),
    (status) => status.status === "ok" || status.status === "error",
    {
      intervalMs: METADATA_POLL_INTERVAL_MS,
      maxIntervalMs: METADATA_POLL_MAX_INTERVAL_MS,
      backoff: "exponential",
      timeoutMs: pollTimeoutMs,
    },
  );
  if (final.status === "error") {
    const detail = final.error !== null ? `: ${final.error}` : "";
    throw new Error(`metadata import failed (id=${importId})${detail}`);
  }
}

interface ResolvedRepoOptions {
  bindMount: BindMount;
  repo: RepoSettings;
}

interface RepoOptionsInput {
  hostPath: string | undefined;
  branch: string | undefined;
  mode: string | undefined;
}

async function resolveRepoOptions(input: RepoOptionsInput): Promise<ResolvedRepoOptions | null> {
  if (input.hostPath === undefined || input.hostPath === "") {
    const explicitBranch = input.branch !== undefined;
    const explicitNonDefaultMode = input.mode !== undefined && input.mode !== DEFAULT_REPO_MODE;
    if (explicitBranch || explicitNonDefaultMode) {
      throw new ConfigError(
        "--repo-branch and --repo-mode require --repo to point at a host repo path",
      );
    }
    return null;
  }
  const hostPath = resolvePath(input.hostPath);
  const stats = await stat(hostPath).catch(() => null);
  if (stats === null || !stats.isDirectory()) {
    throw new ConfigError(`--repo path does not exist or is not a directory: ${hostPath}`);
  }
  const mode = parseRepoMode(input.mode);
  const branch = input.branch ?? (await detectBranch(hostPath));
  return {
    bindMount: { hostPath, containerPath: CONTAINER_REPO_DIR, readOnly: mode === "read-only" },
    repo: { url: REPO_FILE_URL, branch, mode },
  };
}

function parseRepoMode(raw: string | undefined): RepoSyncMode {
  const result = RepoSyncMode.safeParse(raw ?? DEFAULT_REPO_MODE);
  if (!result.success) {
    throw new ConfigError(
      `invalid --repo-mode: "${raw}" (expected one of: ${REPO_SYNC_MODES.join(", ")})`,
    );
  }
  return result.data;
}

async function detectBranch(hostPath: string): Promise<string> {
  const result = await runProcess("git", ["-C", hostPath, "symbolic-ref", "--short", "HEAD"]).catch(
    (error: unknown) => {
      throw new ConfigError(
        `--repo-branch not provided and could not detect a branch at ${hostPath}: ${errorMessage(error)}`,
      );
    },
  );
  if (result.exitCode !== 0) {
    throw new ConfigError(
      `--repo-branch not provided and \`git symbolic-ref\` at ${hostPath} failed: ${result.stderr.trim() || "no output"}`,
    );
  }
  const branch = result.stdout.trim();
  if (branch === "") {
    throw new ConfigError(
      `--repo-branch not provided and HEAD at ${hostPath} resolved to an empty branch name`,
    );
  }
  return branch;
}
