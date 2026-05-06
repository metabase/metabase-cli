import { z } from "zod";

import { resolveLicenseToken } from "../../core/config";
import {
  checkDockerReady,
  containerLifecycleStatus,
  containerNameFor,
  pullImage,
  removeContainer,
  runWorkspaceContainer,
  scrubContainerConfig,
} from "../../core/docker";
import { ConfigError, errorMessage } from "../../core/errors";
import type { Client } from "../../core/http/client";
import { probeHealth } from "../../core/http/probe";
import { localUrl } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { Workspace } from "../../domain/workspace";
import { warn } from "../../output/notice";
import { renderItem } from "../../output/render";
import { findFreePort, isPortFree } from "../../runtime/port";
import { pollUntil } from "../../runtime/poll";
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
      description: `Host port to bind (default: ${DEFAULT_HOST_PORT}; auto-shifts up if taken)`,
    },
    image: {
      type: "string",
      description: `Docker image to run (default: ${DEFAULT_IMAGE})`,
      default: DEFAULT_IMAGE,
    },
    wait: {
      type: "boolean",
      description:
        "Block until /api/health is ready, then scrub the in-container config.yml. Default: return as soon as the container is started.",
      default: false,
    },
    timeout: {
      type: "string",
      description: `Health check deadline in ms (used with --wait; default: ${DEFAULT_HEALTH_TIMEOUT_MS})`,
      default: String(DEFAULT_HEALTH_TIMEOUT_MS),
    },
    pull: {
      type: "boolean",
      description: "Pull the image before starting",
      default: true,
    },
    metadata: {
      type: "boolean",
      description: "Fetch the workspace's warehouse metadata and stage it inside the container",
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
    "metabase workspace start 1 --wait",
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

    const pullPromise = args.pull ? pullImage(args.image) : Promise.resolve();

    const workspace = await client.requestParsed(
      Workspace,
      `/api/ee/workspace-manager/${workspaceId}`,
    );
    assertAllDatabasesProvisioned(workspace);

    const hostPort = await resolveHostPort(requestedPort);

    // Boot bundle stays in process memory: no host-disk artifact for config.yml or
    // metadata.json. The bytes are tar-streamed into the container by docker daemon
    // and land on the container's overlay FS (root-only on the daemon host).
    const [configYaml, metadataJson] = await Promise.all([
      fetchConfigYaml(client, workspaceId),
      args.metadata ? fetchMetadataJson(client, workspaceId) : Promise.resolve(null),
    ]);

    await pullPromise;

    await runWorkspaceContainer({
      workspaceId,
      workspaceName: workspace.name,
      profile: resolved.profile,
      parentUrl: resolved.url,
      image: args.image,
      hostPort,
      configYaml,
      metadataJson,
      licenseToken,
    });

    if (args.wait) {
      await waitForHealth(hostPort, healthTimeoutMs);
      // After Metabase finishes its boot-time read of /mw-config/config.yml (signaled
      // by /api/health going green), unlink the in-container copy too. The host
      // never saw the file, so a scrub failure doesn't fail the start — but it's
      // still surfaced to stderr so the operator knows the in-container copy lingered.
      try {
        await scrubContainerConfig(workspaceId);
      } catch (error) {
        warn(`could not scrub in-container config.yml: ${errorMessage(error)}`);
      }
    }

    const result: StartResult = {
      workspace_id: workspaceId,
      workspace_name: workspace.name,
      container_name: containerName,
      state: args.wait ? "running" : "starting",
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

async function fetchConfigYaml(client: Client, workspaceId: number): Promise<string> {
  const response = await client.requestRaw(`/api/ee/workspace-manager/${workspaceId}/config`, {
    expectContentType: "binary",
  });
  return response.text();
}

async function fetchMetadataJson(client: Client, workspaceId: number): Promise<Uint8Array> {
  const response = await client.requestRaw(
    `/api/ee/workspace-manager/${workspaceId}/metadata/export`,
    { expectContentType: "binary" },
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
