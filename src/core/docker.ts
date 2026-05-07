import { z } from "zod";

import { parseJson } from "../runtime/json";
import { pollUntil } from "../runtime/poll";
import {
  ProcessNotFoundError,
  runProcess,
  runProcessBinary,
  streamProcess,
} from "../runtime/process";
import { buildTar, extractSingleFileFromTar, type TarEntry } from "../runtime/tar";

import { ConfigError, errorMessage } from "./errors";

const DOCKER_BIN = "docker";

const CONTAINER_NAME_PREFIX = "metabase-workspace-";
const VOLUME_NAME_SUFFIX = "-appdb";

const LABEL_ID = "com.metabase.workspace.id";
const LABEL_NAME = "com.metabase.workspace.name";
const LABEL_PROFILE = "com.metabase.workspace.profile";
const LABEL_PARENT = "com.metabase.workspace.parent";
const LABEL_IMAGE = "com.metabase.workspace.image";
const LABEL_HOST_PORT = "com.metabase.workspace.host-port";

export const WORKSPACE_CONTAINER_PORT = 3000;
const CONTAINER_CONFIG_DIR = "/mw-config";
const CONTAINER_CONFIG_DIR_BASENAME = CONTAINER_CONFIG_DIR.replace(/^\//, "");
const CONTAINER_APP_DB_DIR = "/metabase-app-db";
export const CONTAINER_REPO_DIR = "/mnt/repo";
const CONFIG_FILENAME = "config.yml";
const METADATA_FILENAME = "metadata.json";
const CREDENTIALS_FILENAME = "credentials.json";

// Log line emitted by the child once it finishes applying the workspace config block.
// At that point the warehouse credentials in the file have been mirrored into the app
// db and the file itself is safe to delete.
const CONFIG_CONSUMED_MARKER = "Loaded workspace";
// Treat this as a fatal signal and bail out of the wait early instead of timing out.
const INIT_FAILED_MARKER = "Metabase Initialization FAILED";

const CONFIG_CONSUMED_LOG_LINES = 500;
const CONFIG_CONSUMED_INTERVAL_MS = 1_000;
const CONFIG_CONSUMED_MAX_INTERVAL_MS = 3_000;
const INIT_FAILED_TAIL_LINES = 25;
// 0644 inside the container's namespace: files live only on the docker daemon's
// overlay FS (root-only on the host). The Metabase image starts as root and drops
// to a non-root user (uid 2000 by default, configurable via MUID), so the bytes
// must be world-readable for that user to read them. The host never sees them.
const BUNDLE_FILE_MODE = 0o644;

const NO_SUCH_CONTAINER_PATTERN = /no such container/i;
const NO_SUCH_VOLUME_PATTERN = /no such volume/i;

export const CONTAINER_STATES = [
  "running",
  "exited",
  "created",
  "paused",
  "restarting",
  "removing",
  "dead",
] as const;
export type ContainerState = (typeof CONTAINER_STATES)[number];

export type ContainerLifecycleStatus = ContainerState | "missing";

export class DockerError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = "DockerError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class DockerNotInstalledError extends Error {
  constructor() {
    super(
      "docker is not installed or not on PATH — install Docker Desktop / OrbStack / Colima and retry",
    );
    this.name = "DockerNotInstalledError";
  }
}

export class DockerNotRunningError extends Error {
  readonly stderr: string;
  constructor(stderr: string) {
    super("docker is installed but the daemon is not responding — start Docker and retry");
    this.name = "DockerNotRunningError";
    this.stderr = stderr;
  }
}

export interface NamedVolumeMount {
  volume: string;
  container: string;
}

export interface BindMount {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
}

export interface PortMapping {
  hostPort: number;
  containerPort: number;
}

export interface CreateContainerOptions {
  containerName: string;
  image: string;
  port: PortMapping;
  namedVolumes: readonly NamedVolumeMount[];
  bindMounts: readonly BindMount[];
  envVars: Record<string, string>;
  labels: Record<string, string>;
}

export interface WorkspaceContainerSpec {
  workspaceId: number;
  workspaceName: string;
  profile: string;
  parentUrl: string;
  image: string;
  hostPort: number;
  configYaml: string;
  credentialsJson: Uint8Array;
  metadataJson: Uint8Array | null;
  licenseToken: string;
  bindMounts: readonly BindMount[];
}

export interface LogStreamOptions {
  follow: boolean;
  tail: number;
}

const ContainerSummarySchema = z.object({
  ID: z.string(),
  Names: z.string(),
  State: z.string(),
  Status: z.string(),
  Image: z.string(),
  Labels: z.string(),
  Ports: z.string(),
});

export interface WorkspaceContainerSummary {
  containerId: string;
  name: string;
  state: ContainerState;
  status: string;
  image: string;
  workspaceId: number;
  workspaceName: string;
  profile: string | null;
  parentUrl: string | null;
  hostPort: number | null;
}

export function containerNameFor(workspaceId: number): string {
  return `${CONTAINER_NAME_PREFIX}${workspaceId}`;
}

export function volumeNameFor(workspaceId: number): string {
  return `${CONTAINER_NAME_PREFIX}${workspaceId}${VOLUME_NAME_SUFFIX}`;
}

interface DockerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface DockerExecOptions {
  env?: NodeJS.ProcessEnv;
  stdin?: Uint8Array | string;
}

interface DockerRunOptions extends DockerExecOptions {
  ignorePattern?: RegExp;
}

async function dockerExec(
  args: readonly string[],
  options: DockerExecOptions = {},
): Promise<DockerExecResult> {
  try {
    return await runProcess(DOCKER_BIN, args, options);
  } catch (error) {
    if (error instanceof ProcessNotFoundError) {
      throw new DockerNotInstalledError();
    }
    throw error;
  }
}

async function runDocker(
  args: readonly string[],
  failureMessage: string,
  options: DockerRunOptions = {},
): Promise<DockerExecResult> {
  const { ignorePattern, ...execOptions } = options;
  const result = await dockerExec(args, execOptions);
  if (result.exitCode === 0) {
    return result;
  }
  if (ignorePattern?.test(result.stderr)) {
    return result;
  }
  throw new DockerError(failureMessage, result.exitCode, result.stderr);
}

export async function checkDockerReady(): Promise<void> {
  let result: DockerExecResult;
  try {
    result = await runProcess(DOCKER_BIN, ["version", "--format", "{{.Server.Version}}"]);
  } catch (error) {
    if (error instanceof ProcessNotFoundError) {
      throw new DockerNotInstalledError();
    }
    throw error;
  }
  if (result.exitCode !== 0) {
    throw new DockerNotRunningError(result.stderr);
  }
}

export async function pullImage(image: string): Promise<void> {
  const code = await streamProcess(DOCKER_BIN, ["pull", image]);
  if (code !== 0) {
    throw new DockerError(`docker pull ${image} failed`, code, "");
  }
}

export async function containerLifecycleStatus(
  containerName: string,
): Promise<ContainerLifecycleStatus> {
  const result = await runDocker(
    ["ps", "-a", "--filter", `name=^${containerName}$`, "--format", "{{.State}}"],
    "docker ps failed",
  );
  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) {
    return "missing";
  }
  return parseContainerState(trimmed);
}

function parseContainerState(raw: string): ContainerState {
  const lower = raw.toLowerCase();
  for (const known of CONTAINER_STATES) {
    if (known === lower) {
      return known;
    }
  }
  throw new DockerError(`unknown docker container state: ${JSON.stringify(raw)}`, null, "");
}

// Boots without materializing the boot bundle on host disk: the tar streams through
// `docker cp -` into the container's /mw-config, which lives on the daemon's overlay
// FS (root-only on the docker host).
export async function runWorkspaceContainer(spec: WorkspaceContainerSpec): Promise<void> {
  const containerName = containerNameFor(spec.workspaceId);
  await createContainer({
    containerName,
    image: spec.image,
    port: { hostPort: spec.hostPort, containerPort: WORKSPACE_CONTAINER_PORT },
    namedVolumes: [{ volume: volumeNameFor(spec.workspaceId), container: CONTAINER_APP_DB_DIR }],
    bindMounts: spec.bindMounts,
    envVars: workspaceContainerEnv(spec),
    labels: workspaceContainerLabels(spec),
  });
  try {
    await copyTarToContainer(containerName, "/", buildBootBundleTar(spec));
    await startContainer(containerName);
  } catch (error) {
    // Reverse the create so the caller's `--force` path still finds a clean slate.
    await removeContainer(containerName).catch(() => undefined);
    throw error;
  }
}

export async function scrubContainerConfig(workspaceId: number): Promise<void> {
  const containerName = containerNameFor(workspaceId);
  await runDocker(
    ["exec", containerName, "rm", "-f", `${CONTAINER_CONFIG_DIR}/${CONFIG_FILENAME}`],
    `docker exec rm config.yml failed for ${containerName}`,
  );
}

export async function waitForConfigConsumed(workspaceId: number, timeoutMs: number): Promise<void> {
  const containerName = containerNameFor(workspaceId);
  await pollUntil(
    async () => {
      const result = await dockerExec([
        "logs",
        "--tail",
        String(CONFIG_CONSUMED_LOG_LINES),
        containerName,
      ]);
      const haystack = `${result.stdout}\n${result.stderr}`;
      if (haystack.includes(INIT_FAILED_MARKER)) {
        const tail = haystack.split("\n").slice(-INIT_FAILED_TAIL_LINES).join("\n");
        throw new DockerError(
          `workspace ${workspaceId} container failed Metabase initialization`,
          null,
          tail,
        );
      }
      return haystack.includes(CONFIG_CONSUMED_MARKER);
    },
    (consumed) => consumed,
    {
      intervalMs: CONFIG_CONSUMED_INTERVAL_MS,
      maxIntervalMs: CONFIG_CONSUMED_MAX_INTERVAL_MS,
      backoff: "exponential",
      timeoutMs,
    },
  );
}

export async function readContainerCredentialsFile(workspaceId: number): Promise<Uint8Array> {
  const containerName = containerNameFor(workspaceId);
  const result = await runProcessBinary(DOCKER_BIN, [
    "cp",
    `${containerName}:${CONTAINER_CONFIG_DIR}/${CREDENTIALS_FILENAME}`,
    "-",
  ]);
  if (result.exitCode !== 0) {
    if (NO_SUCH_CONTAINER_PATTERN.test(result.stderr)) {
      throw new DockerError(
        `no container for workspace ${workspaceId}`,
        result.exitCode,
        result.stderr,
      );
    }
    throw new DockerError(
      `docker cp ${CREDENTIALS_FILENAME} from ${containerName} failed`,
      result.exitCode,
      result.stderr,
    );
  }
  return extractSingleFileFromTar(result.stdout, CREDENTIALS_FILENAME);
}

function buildBootBundleTar(spec: WorkspaceContainerSpec): Uint8Array {
  const entries: TarEntry[] = [
    { type: "directory", name: CONTAINER_CONFIG_DIR_BASENAME },
    {
      type: "file",
      name: `${CONTAINER_CONFIG_DIR_BASENAME}/${CONFIG_FILENAME}`,
      content: spec.configYaml,
      mode: BUNDLE_FILE_MODE,
    },
    {
      type: "file",
      name: `${CONTAINER_CONFIG_DIR_BASENAME}/${CREDENTIALS_FILENAME}`,
      content: spec.credentialsJson,
      mode: BUNDLE_FILE_MODE,
    },
  ];
  if (spec.metadataJson !== null) {
    entries.push({
      type: "file",
      name: `${CONTAINER_CONFIG_DIR_BASENAME}/${METADATA_FILENAME}`,
      content: spec.metadataJson,
      mode: BUNDLE_FILE_MODE,
    });
  }
  return buildTar(entries);
}

function workspaceContainerLabels(spec: WorkspaceContainerSpec): Record<string, string> {
  return {
    [LABEL_ID]: String(spec.workspaceId),
    [LABEL_NAME]: spec.workspaceName,
    [LABEL_PROFILE]: spec.profile,
    [LABEL_PARENT]: spec.parentUrl,
    [LABEL_IMAGE]: spec.image,
    [LABEL_HOST_PORT]: String(spec.hostPort),
  };
}

function workspaceContainerEnv(spec: WorkspaceContainerSpec): Record<string, string> {
  const env: Record<string, string> = {
    MB_CONFIG_FILE_PATH: `${CONTAINER_CONFIG_DIR}/${CONFIG_FILENAME}`,
    MB_PREMIUM_EMBEDDING_TOKEN: spec.licenseToken,
    MB_DB_FILE: `${CONTAINER_APP_DB_DIR}/metabase.db`,
    JAVA_OPTS: "-Xmx2g",
  };
  if (spec.metadataJson !== null) {
    env["MB_TABLE_METADATA_PATH"] = `${CONTAINER_CONFIG_DIR}/${METADATA_FILENAME}`;
  }
  return env;
}

async function createContainer(options: CreateContainerOptions): Promise<void> {
  const args: string[] = [
    "create",
    "--name",
    options.containerName,
    "-p",
    `${options.port.hostPort}:${options.port.containerPort}`,
  ];
  for (const [key, value] of Object.entries(options.labels)) {
    args.push("--label", `${key}=${value}`);
  }
  for (const mount of options.namedVolumes) {
    args.push("-v", `${mount.volume}:${mount.container}`);
  }
  for (const bind of options.bindMounts) {
    args.push("-v", `${bind.hostPath}:${bind.containerPath}:${bind.readOnly ? "ro" : "rw"}`);
  }
  for (const key of Object.keys(options.envVars)) {
    args.push("-e", key);
  }
  args.push(options.image);

  const env: NodeJS.ProcessEnv = { ...process.env, ...options.envVars };
  await runDocker(args, `docker create failed for ${options.containerName}`, { env });
}

async function copyTarToContainer(
  containerName: string,
  destPath: string,
  tarBytes: Uint8Array,
): Promise<void> {
  await runDocker(
    ["cp", "-", `${containerName}:${destPath}`],
    `docker cp into ${containerName}:${destPath} failed`,
    { stdin: tarBytes },
  );
}

async function startContainer(containerName: string): Promise<void> {
  await runDocker(["start", containerName], `docker start failed for ${containerName}`);
}

export async function stopContainer(containerName: string): Promise<void> {
  await runDocker(["stop", containerName], `docker stop ${containerName} failed`, {
    ignorePattern: NO_SUCH_CONTAINER_PATTERN,
  });
}

export async function removeContainer(containerName: string): Promise<boolean> {
  const result = await runDocker(["rm", "-f", containerName], `docker rm ${containerName} failed`, {
    ignorePattern: NO_SUCH_CONTAINER_PATTERN,
  });
  return result.exitCode === 0;
}

export async function removeVolume(volumeName: string): Promise<boolean> {
  const result = await runDocker(
    ["volume", "rm", volumeName],
    `docker volume rm ${volumeName} failed`,
    { ignorePattern: NO_SUCH_VOLUME_PATTERN },
  );
  return result.exitCode === 0;
}

export async function listWorkspaceContainers(): Promise<WorkspaceContainerSummary[]> {
  const result = await runDocker(
    ["ps", "-a", "--filter", `label=${LABEL_ID}`, "--format", "{{json .}}"],
    "docker ps failed",
  );
  return parseContainerLines(result.stdout);
}

export async function inspectWorkspaceContainer(
  containerName: string,
): Promise<WorkspaceContainerSummary | null> {
  const result = await runDocker(
    [
      "ps",
      "-a",
      "--filter",
      `name=^${containerName}$`,
      "--filter",
      `label=${LABEL_ID}`,
      "--format",
      "{{json .}}",
    ],
    "docker ps failed",
  );
  const summaries = parseContainerLines(result.stdout);
  return summaries[0] ?? null;
}

export interface WorkspaceContainerLocation {
  containerName: string;
  hostPort: number;
}

export async function requireWorkspaceContainerLocation(
  workspaceId: number,
): Promise<WorkspaceContainerLocation> {
  const containerName = containerNameFor(workspaceId);
  const summary = await inspectWorkspaceContainer(containerName);
  if (summary === null) {
    throw new ConfigError(
      `no container for workspace ${workspaceId} — run \`metabase workspace start ${workspaceId}\` first`,
    );
  }
  if (summary.hostPort === null) {
    throw new ConfigError(
      `container ${containerName} is missing the host-port label — likely created by a different tool`,
    );
  }
  return { containerName, hostPort: summary.hostPort };
}

export function streamLogs(
  containerName: string,
  options: LogStreamOptions,
): Promise<number | null> {
  const args: string[] = ["logs", "--tail", String(options.tail)];
  if (options.follow) {
    args.push("--follow");
  }
  args.push(containerName);
  return streamProcess(DOCKER_BIN, args);
}

export function parseContainerLines(stdout: string): WorkspaceContainerSummary[] {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const summaries: WorkspaceContainerSummary[] = [];
  for (const line of lines) {
    const summary = parseContainerLine(line);
    if (summary !== null) {
      summaries.push(summary);
    }
  }
  return summaries;
}

export function parseContainerLine(line: string): WorkspaceContainerSummary | null {
  let raw: unknown;
  try {
    raw = parseJson(line, z.unknown(), { source: "docker" });
  } catch (error) {
    throw new DockerError(`could not parse docker output: ${errorMessage(error)}`, null, line);
  }
  const parsed = ContainerSummarySchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const labels = parseLabels(parsed.data.Labels);
  const idLabel = labels[LABEL_ID];
  const nameLabel = labels[LABEL_NAME];
  if (idLabel === undefined || nameLabel === undefined) {
    return null;
  }
  const idNum = Number.parseInt(idLabel, 10);
  if (!Number.isFinite(idNum) || idNum < 1) {
    return null;
  }
  const portLabel = labels[LABEL_HOST_PORT];
  const portNum = portLabel !== undefined ? Number.parseInt(portLabel, 10) : Number.NaN;
  return {
    containerId: parsed.data.ID,
    name: parsed.data.Names,
    state: parseContainerState(parsed.data.State),
    status: parsed.data.Status,
    image: parsed.data.Image,
    workspaceId: idNum,
    workspaceName: nameLabel,
    profile: labels[LABEL_PROFILE] ?? null,
    parentUrl: labels[LABEL_PARENT] ?? null,
    hostPort: Number.isFinite(portNum) ? portNum : null,
  };
}

function parseLabels(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key.length > 0) {
      out[key] = value;
    }
  }
  return out;
}
