// Constructed, not recorded: the slot's Metabase holds no licence, so it refuses every remote-sync
// route. This front plays a licensed instance for those routes alone: its session properties grant
// `remote_sync`, it keeps a tracked branch, the edits made in Metabase and whether the remote moved,
// and it runs an import as a task whose progress the scenario holds and releases. Every other
// request, the eid translation behind a synced object's link included, goes to the slot's Metabase
// under the bootstrap API key.
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { z } from "zod";

import { errorMessage } from "@metabase/client/errors";
import { SyncDirtyItem, type SyncTask } from "@metabase/client/domain/git-sync";
import { JSON_CONTENT_TYPE, parseJson } from "@metabase/client/json";

import type { E2EBootstrap } from "../../../../tests/e2e/bootstrap-data";
import { DriverFailure } from "../app";

const LOOPBACK_HOST = "127.0.0.1";
const DISCOVERY_PATH = "/.well-known/oauth-authorization-server";
const PROPERTIES_PATH = "/api/session/properties";
const BRANCH_SETTING_PATH = "/api/setting/remote-sync-branch";
const CURRENT_TASK_PATH = "/api/ee/remote-sync/current-task";
const IS_DIRTY_PATH = "/api/ee/remote-sync/is-dirty";
const DIRTY_PATH = "/api/ee/remote-sync/dirty";
const REMOTE_CHANGES_PATH = "/api/ee/remote-sync/has-remote-changes";
const IMPORT_PATH = "/api/ee/remote-sync/import";
const API_KEY_HEADER = "x-api-key";
const DROPPED_HEADERS: ReadonlySet<string> = new Set(["host", "accept-encoding", "content-length"]);
const TOKEN_FEATURES_KEY = "token-features";
const REMOTE_SYNC_FEATURE = "remote_sync";
const REMOTE_VERSION = "b7e1f0c";
const LOCAL_VERSION = "4a2d9e3";

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_BAD_GATEWAY = 502;

// Where a held import stops, so a shot shows a bar part of the way along.
export const HELD_PROGRESS = 0.4;

const SessionPropertiesBody = z
  .object({ [TOKEN_FEATURES_KEY]: z.record(z.string(), z.boolean()) })
  .loose();

const ImportBody = z.object({ branch: z.string().min(1) }).loose();

interface RemoteSyncSeed {
  readonly branch: string;
  readonly dirty: readonly SyncDirtyItem[];
  readonly remoteChanges: boolean;
}

interface FrontState {
  branch: string;
  dirty: readonly SyncDirtyItem[];
  remoteChanges: boolean;
  task: SyncTask | null;
  holding: boolean;
  nextTaskId: number;
}

export interface RemoteSyncFront {
  readonly url: string;
  // An import started after this stays running at HELD_PROGRESS until `release`.
  readonly hold: () => void;
  readonly release: () => void;
  readonly imported: () => string | null;
  readonly stop: () => Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": JSON_CONTENT_TYPE });
  response.end(JSON.stringify(body));
}

async function readBody(message: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pathOf(target: string): string {
  const at = target.indexOf("?");
  return at === -1 ? target : target.slice(0, at);
}

function forwardedHeaders(headers: IncomingHttpHeaders, apiKey: string): OutgoingHttpHeaders {
  const kept = Object.entries(headers).filter(([name]) => !DROPPED_HEADERS.has(name));
  return { ...Object.fromEntries(kept), [API_KEY_HEADER]: apiKey };
}

interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

async function ask(
  bootstrap: E2EBootstrap,
  target: string,
  incoming: IncomingMessage,
): Promise<Answer> {
  const body = await readBody(incoming);
  return new Promise<Answer>((resolve, reject) => {
    const outgoing = request(`${bootstrap.baseUrl}${target}`, {
      method: incoming.method,
      headers: forwardedHeaders(incoming.headers, bootstrap.adminApiKey),
    });
    outgoing.on("response", (answer) => {
      void readBody(answer).then((text) => {
        resolve({
          status: answer.statusCode ?? HTTP_BAD_GATEWAY,
          headers: answer.headers,
          body: text,
        });
      }, reject);
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function forward(
  bootstrap: E2EBootstrap,
  target: string,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const answer = await ask(bootstrap, target, incoming);
  const headers = { ...answer.headers };
  delete headers["content-length"];
  delete headers["transfer-encoding"];
  response.writeHead(answer.status, headers);
  response.end(answer.body);
}

async function licensedProperties(
  bootstrap: E2EBootstrap,
  target: string,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const answer = await ask(bootstrap, target, incoming);
  const properties = parseJson(answer.body, SessionPropertiesBody, { source: PROPERTIES_PATH });
  const features = { ...properties[TOKEN_FEATURES_KEY], [REMOTE_SYNC_FEATURE]: true };
  sendJson(response, answer.status, { ...properties, [TOKEN_FEATURES_KEY]: features });
}

function importTask(id: number, startedAt: string, status: SyncTask["status"]): SyncTask {
  const done = status !== "running";
  return {
    id,
    sync_task_type: "import",
    status,
    progress: done ? 1 : HELD_PROGRESS,
    started_at: startedAt,
    ended_at: done ? new Date().toISOString() : null,
    version: REMOTE_VERSION,
    error_message: null,
  };
}

function finishImport(state: FrontState, running: SyncTask): void {
  state.task = importTask(running.id, running.started_at, "successful");
  state.dirty = [];
  state.remoteChanges = false;
  state.nextTaskId += 1;
}

async function startImport(
  state: FrontState,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = parseJson(await readBody(incoming), ImportBody, { source: IMPORT_PATH });
  state.branch = body.branch;
  const running = importTask(state.nextTaskId, new Date().toISOString(), "running");
  state.task = running;
  if (!state.holding) {
    finishImport(state, running);
  }
  sendJson(response, HTTP_OK, { status: "success", task_id: running.id });
}

function answerRemoteSync(state: FrontState, path: string, response: ServerResponse): boolean {
  if (path === BRANCH_SETTING_PATH) {
    sendJson(response, HTTP_OK, state.branch);
    return true;
  }
  if (path === CURRENT_TASK_PATH) {
    if (state.task === null) {
      response.writeHead(HTTP_NO_CONTENT);
      response.end();
      return true;
    }
    sendJson(response, HTTP_OK, state.task);
    return true;
  }
  if (path === IS_DIRTY_PATH) {
    sendJson(response, HTTP_OK, { is_dirty: state.dirty.length > 0 });
    return true;
  }
  if (path === DIRTY_PATH) {
    sendJson(response, HTTP_OK, { dirty: state.dirty });
    return true;
  }
  if (path === REMOTE_CHANGES_PATH) {
    sendJson(response, HTTP_OK, {
      has_changes: state.remoteChanges,
      remote_version: REMOTE_VERSION,
      local_version: state.remoteChanges ? LOCAL_VERSION : REMOTE_VERSION,
      cached: false,
    });
    return true;
  }
  return false;
}

async function handle(
  bootstrap: E2EBootstrap,
  state: FrontState,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const target = incoming.url;
  if (target === undefined) {
    sendJson(response, HTTP_BAD_REQUEST, { error: "no request target" });
    return;
  }
  const path = pathOf(target);
  if (path === DISCOVERY_PATH) {
    sendJson(response, HTTP_BAD_REQUEST, { error: "this front offers API keys only" });
    return;
  }
  if (path === PROPERTIES_PATH) {
    await licensedProperties(bootstrap, target, incoming, response);
    return;
  }
  if (path === IMPORT_PATH && incoming.method === "POST") {
    await startImport(state, incoming, response);
    return;
  }
  if (answerRemoteSync(state, path, response)) {
    return;
  }
  await forward(bootstrap, target, incoming, response);
}

export async function startRemoteSyncFront(
  bootstrap: E2EBootstrap,
  seed: RemoteSyncSeed,
): Promise<RemoteSyncFront> {
  const state: FrontState = {
    branch: seed.branch,
    dirty: seed.dirty.map((item) => SyncDirtyItem.parse(item)),
    remoteChanges: seed.remoteChanges,
    task: null,
    holding: false,
    nextTaskId: 1,
  };
  const server = createServer((incoming, response) => {
    handle(bootstrap, state, incoming, response).catch((error: unknown) => {
      sendJson(response, HTTP_BAD_GATEWAY, { error: errorMessage(error) });
    });
  });
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const bound = server.address();
      if (bound === null || typeof bound === "string") {
        reject(new DriverFailure("the remote-sync front bound no TCP port"));
        return;
      }
      resolve(bound);
    });
  });
  return {
    url: `http://${LOOPBACK_HOST}:${String(address.port)}`,
    hold: () => {
      state.holding = true;
    },
    release: () => {
      state.holding = false;
      if (state.task?.status === "running") {
        finishImport(state, state.task);
      }
    },
    imported: () => (state.task?.status === "successful" ? state.branch : null),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
        server.closeAllConnections();
      }),
  };
}
