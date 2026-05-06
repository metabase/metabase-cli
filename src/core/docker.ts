import { z } from "zod";

import { parseJson } from "../runtime/json";
import { ProcessNotFoundError, runProcess, streamProcess } from "../runtime/process";

import { errorMessage } from "./errors";

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
const CONTAINER_APP_DB_DIR = "/metabase-app-db";
export const CONFIG_FILENAME = "config.yml";
export const METADATA_FILENAME = "metadata.json";

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

export interface VolumeMount {
  host: string;
  container: string;
  readOnly?: boolean;
}

export interface NamedVolumeMount {
  volume: string;
  container: string;
}

export interface PortMapping {
  hostPort: number;
  containerPort: number;
}

export interface RunContainerOptions {
  containerName: string;
  image: string;
  port: PortMapping;
  bindMounts: readonly VolumeMount[];
  namedVolumes: readonly NamedVolumeMount[];
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
  bootConfigDir: string;
  licenseToken: string;
  includeMetadata: boolean;
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

async function dockerExec(
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<DockerExecResult> {
  try {
    return await runProcess(DOCKER_BIN, args, env ? { env } : {});
  } catch (error) {
    if (error instanceof ProcessNotFoundError) {
      throw new DockerNotInstalledError();
    }
    throw error;
  }
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
  const result = await dockerExec([
    "ps",
    "-a",
    "--filter",
    `name=^${containerName}$`,
    "--format",
    "{{.State}}",
  ]);
  if (result.exitCode !== 0) {
    throw new DockerError("docker ps failed", result.exitCode, result.stderr);
  }
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

export async function runWorkspaceContainer(spec: WorkspaceContainerSpec): Promise<void> {
  await runContainer({
    containerName: containerNameFor(spec.workspaceId),
    image: spec.image,
    port: { hostPort: spec.hostPort, containerPort: WORKSPACE_CONTAINER_PORT },
    bindMounts: [{ host: spec.bootConfigDir, container: CONTAINER_CONFIG_DIR, readOnly: true }],
    namedVolumes: [{ volume: volumeNameFor(spec.workspaceId), container: CONTAINER_APP_DB_DIR }],
    envVars: workspaceContainerEnv(spec.licenseToken, spec.includeMetadata),
    labels: workspaceContainerLabels(spec),
  });
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

function workspaceContainerEnv(
  licenseToken: string,
  includeMetadata: boolean,
): Record<string, string> {
  const env: Record<string, string> = {
    MB_CONFIG_FILE_PATH: `${CONTAINER_CONFIG_DIR}/${CONFIG_FILENAME}`,
    MB_PREMIUM_EMBEDDING_TOKEN: licenseToken,
    MB_DB_FILE: `${CONTAINER_APP_DB_DIR}/metabase.db`,
    JAVA_OPTS: "-Xmx2g",
  };
  if (includeMetadata) {
    env["MB_DATABASE_METADATA_PATH"] = `${CONTAINER_CONFIG_DIR}/${METADATA_FILENAME}`;
  }
  return env;
}

export async function runContainer(options: RunContainerOptions): Promise<void> {
  const args: string[] = [
    "run",
    "-d",
    "--name",
    options.containerName,
    "-p",
    `${options.port.hostPort}:${options.port.containerPort}`,
  ];
  for (const [key, value] of Object.entries(options.labels)) {
    args.push("--label", `${key}=${value}`);
  }
  for (const mount of options.bindMounts) {
    const suffix = mount.readOnly ? ":ro" : "";
    args.push("-v", `${mount.host}:${mount.container}${suffix}`);
  }
  for (const mount of options.namedVolumes) {
    args.push("-v", `${mount.volume}:${mount.container}`);
  }
  for (const key of Object.keys(options.envVars)) {
    args.push("-e", key);
  }
  args.push(options.image);

  const env: NodeJS.ProcessEnv = { ...process.env, ...options.envVars };
  const result = await dockerExec(args, env);
  if (result.exitCode !== 0) {
    throw new DockerError(
      `docker run failed for ${options.containerName}`,
      result.exitCode,
      result.stderr,
    );
  }
}

export async function stopContainer(containerName: string): Promise<void> {
  const result = await dockerExec(["stop", containerName]);
  if (result.exitCode !== 0 && !NO_SUCH_CONTAINER_PATTERN.test(result.stderr)) {
    throw new DockerError(`docker stop ${containerName} failed`, result.exitCode, result.stderr);
  }
}

export async function removeContainer(containerName: string): Promise<boolean> {
  const result = await dockerExec(["rm", "-f", containerName]);
  if (result.exitCode === 0) {
    return true;
  }
  if (NO_SUCH_CONTAINER_PATTERN.test(result.stderr)) {
    return false;
  }
  throw new DockerError(`docker rm ${containerName} failed`, result.exitCode, result.stderr);
}

export async function removeVolume(volumeName: string): Promise<boolean> {
  const result = await dockerExec(["volume", "rm", volumeName]);
  if (result.exitCode === 0) {
    return true;
  }
  if (NO_SUCH_VOLUME_PATTERN.test(result.stderr)) {
    return false;
  }
  throw new DockerError(`docker volume rm ${volumeName} failed`, result.exitCode, result.stderr);
}

export async function listWorkspaceContainers(): Promise<WorkspaceContainerSummary[]> {
  const result = await dockerExec([
    "ps",
    "-a",
    "--filter",
    `label=${LABEL_ID}`,
    "--format",
    "{{json .}}",
  ]);
  if (result.exitCode !== 0) {
    throw new DockerError("docker ps failed", result.exitCode, result.stderr);
  }
  return parseContainerLines(result.stdout);
}

export async function inspectWorkspaceContainer(
  containerName: string,
): Promise<WorkspaceContainerSummary | null> {
  const result = await dockerExec([
    "ps",
    "-a",
    "--filter",
    `name=^${containerName}$`,
    "--filter",
    `label=${LABEL_ID}`,
    "--format",
    "{{json .}}",
  ]);
  if (result.exitCode !== 0) {
    throw new DockerError("docker ps failed", result.exitCode, result.stderr);
  }
  const summaries = parseContainerLines(result.stdout);
  return summaries[0] ?? null;
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
