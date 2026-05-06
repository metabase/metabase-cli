import { join } from "node:path";

import { z } from "zod";

import { resolveLicenseToken } from "../../core/config";
import {
  CONFIG_FILENAME,
  METADATA_FILENAME,
  checkDockerReady,
  containerLifecycleStatus,
  containerNameFor,
  pullImage,
  removeContainer,
  runWorkspaceContainer,
} from "../../core/docker";
import { ConfigError } from "../../core/errors";
import type { Client } from "../../core/http/client";
import { probeHealth } from "../../core/http/probe";
import { localUrl } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { Workspace } from "../../domain/workspace";
import { renderItem } from "../../output/render";
import { findFreePort, isPortFree } from "../../runtime/port";
import { pollUntil } from "../../runtime/poll";
import {
  mkSecureTempDir,
  removeTempDir,
  streamToSecureFile,
  writeSecureFile,
} from "../../runtime/tempdir";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { parseInteger, parseOptionalInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

const DEFAULT_IMAGE = "metabase/metabase-dev:feature-workspaces-v2";
const DEFAULT_HOST_PORT = 3000;
const DEFAULT_HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_INTERVAL_MS = 2_000;
const HEALTH_MAX_INTERVAL_MS = 10_000;
const HEALTH_PROBE_TIMEOUT_MS = 4_000;

export const StartResult = z.object({
  workspace_id: z.number().int().positive(),
  workspace_name: z.string(),
  container_name: z.string(),
  state: z.literal("running"),
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
      description: `Host port to bind (default: ${DEFAULT_HOST_PORT}; auto-shifts up if taken)`,
    },
    image: {
      type: "string",
      description: `Docker image to run (default: ${DEFAULT_IMAGE})`,
      default: DEFAULT_IMAGE,
    },
    timeout: {
      type: "string",
      description: `Health check deadline in ms (default: ${DEFAULT_HEALTH_TIMEOUT_MS})`,
      default: String(DEFAULT_HEALTH_TIMEOUT_MS),
    },
    pull: {
      type: "boolean",
      description: "Pull the image before starting",
      default: true,
    },
    metadata: {
      type: "boolean",
      description: "Fetch the workspace's warehouse metadata and mount it as metadata.json",
      default: true,
    },
    force: {
      type: "boolean",
      description: "If a container for this workspace already exists, remove it first",
      default: false,
    },
  },
  outputSchema: StartResult,
  examples: [
    "metabase workspace start 1",
    "metabase workspace start 1 --port 3100",
    "metabase workspace start 1 --image metabase/metabase-dev:feature-workspaces-v2 --no-pull",
    "metabase workspace start 1 --force",
  ],
  async run({ args, ctx, getClient, getResolvedConfig }) {
    const workspaceId = parseId(args.id);
    const containerName = containerNameFor(workspaceId);
    const requestedPort = parseOptionalInteger(args.port, { name: "--port", min: 1 });
    const healthTimeoutMs = parseInteger(args.timeout ?? String(DEFAULT_HEALTH_TIMEOUT_MS), {
      name: "--timeout",
      min: 1000,
    });

    const client = await getClient();
    const resolved = await getResolvedConfig();
    const licenseToken = await resolveLicenseToken({});

    await checkDockerReady();
    await ensureNoExistingContainer(containerName, args.force);

    // Kick off the image pull concurrently with the parent fetches; await before runContainer.
    const pullPromise = args.pull ? pullImage(args.image) : Promise.resolve();

    const workspace = await client.requestParsed(
      Workspace,
      `/api/ee/workspace-manager/${workspaceId}`,
    );
    assertAllDatabasesProvisioned(workspace);

    const hostPort = await resolveHostPort(requestedPort);

    const tempDir = await mkSecureTempDir();
    try {
      await Promise.all([
        writeConfigYaml(client, workspaceId, join(tempDir, CONFIG_FILENAME)),
        args.metadata
          ? streamMetadata(client, workspaceId, join(tempDir, METADATA_FILENAME))
          : Promise.resolve(),
      ]);

      await pullPromise;

      await runWorkspaceContainer({
        workspaceId,
        workspaceName: workspace.name,
        profile: resolved.profile,
        parentUrl: resolved.url,
        image: args.image,
        hostPort,
        bootConfigDir: tempDir,
        licenseToken,
        includeMetadata: args.metadata,
      });

      await waitForHealth(hostPort, healthTimeoutMs);
    } finally {
      // config.yml carries DB credentials and the license token; scrub on
      // every exit so secrets don't linger on disk.
      await removeTempDir(tempDir);
    }

    const result: StartResult = {
      workspace_id: workspaceId,
      workspace_name: workspace.name,
      container_name: containerName,
      state: "running",
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

async function ensureNoExistingContainer(containerName: string, force: boolean): Promise<void> {
  if (!force) {
    const status = await containerLifecycleStatus(containerName);
    if (status !== "missing") {
      throw new ConfigError(
        `container ${containerName} already exists (state=${status}). Use --force to recreate, or stop/remove it first.`,
      );
    }
    return;
  }
  await removeContainer(containerName);
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

async function writeConfigYaml(
  client: Client,
  workspaceId: number,
  destination: string,
): Promise<void> {
  // config.yml is small (one workspace + a handful of databases) — buffering is
  // simpler than streaming and lets us write atomically through writeSecureFile.
  const response = await client.requestRaw(`/api/ee/workspace-manager/${workspaceId}/config`, {
    expectContentType: "binary",
  });
  await writeSecureFile(destination, await response.text());
}

async function streamMetadata(
  client: Client,
  workspaceId: number,
  destination: string,
): Promise<void> {
  // metadata.json can be tens of MB on a real warehouse; stream straight to disk
  // instead of buffering twice (response.text + writeSecureFile).
  const stream = await client.requestStream(
    `/api/ee/workspace-manager/${workspaceId}/metadata/export`,
  );
  await streamToSecureFile(stream, destination);
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
