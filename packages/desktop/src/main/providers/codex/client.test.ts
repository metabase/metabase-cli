import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import type { ProviderLog } from "../log";

import { CodexClient, CodexProtocolError, CodexRequestFailed } from "./client";
import { AnyResult, type CodexNotification, type CodexRequest } from "./protocol";

interface Harness {
  readonly client: CodexClient;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly written: string[];
  readonly notifications: CodexNotification[];
  readonly requests: CodexRequest[];
  readonly errors: CodexProtocolError[];
  readonly records: string[];
}

function collectingLog(into: string[]): ProviderLog {
  return {
    write: (chunk) => {
      into.push(chunk);
    },
    close: () => Promise.resolve(),
  };
}

function harness(): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: string[] = [];
  const notifications: CodexNotification[] = [];
  const requests: CodexRequest[] = [];
  const errors: CodexProtocolError[] = [];
  const records: string[] = [];
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    written.push(chunk);
  });
  const client = new CodexClient({
    stdin,
    stdout,
    stderr,
    log: collectingLog([]),
    handlers: {
      onNotification: (notification) => {
        notifications.push(notification);
      },
      onRequest: (request) => {
        requests.push(request);
      },
      onProtocolError: (error) => {
        errors.push(error);
      },
      onStderr: (message) => {
        records.push(message);
      },
    },
  });
  return { client, stdout, stderr, written, notifications, requests, errors, records };
}

async function feed(stream: PassThrough, chunk: string): Promise<void> {
  stream.write(chunk);
  await setImmediate();
}

async function refusal(promise: Promise<unknown>): Promise<CodexRequestFailed> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CodexRequestFailed) {
      return error;
    }
    throw error;
  }
  throw new Error("the request settled instead of failing");
}

describe("reading frames off stdout", () => {
  it("reads a frame split across two chunks once and whole", async () => {
    const codex = harness();

    await feed(codex.stdout, '{"method":"thread/compacted","params":{"threadId":"t1"');
    await feed(codex.stdout, ',"turnId":"u1"}}\n');

    expect(codex.notifications).toEqual([
      {
        kind: "notification",
        method: "thread/compacted",
        params: { threadId: "t1", turnId: "u1" },
      },
    ]);
  });

  it("reads two frames arriving in one chunk in order", async () => {
    const codex = harness();

    await feed(
      codex.stdout,
      '{"method":"turn/started","params":{"threadId":"t1"}}\n{"method":"turn/completed","params":{"threadId":"t1"}}\n',
    );

    expect(codex.notifications).toEqual([
      { kind: "notification", method: "turn/started", params: { threadId: "t1" } },
      { kind: "notification", method: "turn/completed", params: { threadId: "t1" } },
    ]);
  });

  it("forwards a notification method it has never seen", async () => {
    const codex = harness();

    await feed(
      codex.stdout,
      '{"method":"remoteControl/status/changed","params":{"status":"disabled"},"emittedAtMs":1790090863230}\n',
    );

    expect(codex.notifications).toEqual([
      {
        kind: "notification",
        method: "remoteControl/status/changed",
        params: { status: "disabled" },
      },
    ]);
  });

  it("reads a frame carrying both a method and an id as a request, never a notification", async () => {
    const codex = harness();

    await feed(
      codex.stdout,
      '{"id":11,"method":"item/fileChange/requestApproval","params":{"itemId":"i1"}}\n',
    );

    expect(codex.notifications).toEqual([]);
    expect(codex.requests).toEqual([
      {
        kind: "request",
        id: 11,
        method: "item/fileChange/requestApproval",
        params: { itemId: "i1" },
      },
    ]);
  });

  it("refuses a frame it cannot route, naming the line and the text", async () => {
    const codex = harness();

    await feed(codex.stdout, '{"id":7}\n');

    expect(codex.errors.map((error) => error.message)).toEqual([
      'codex stdout line 1 (no request, notification or response shape matched): {"id":7}',
    ]);
  });

  it("refuses a line that is not JSON, naming the line and the text", async () => {
    const codex = harness();

    await feed(codex.stdout, "\nthread/started\n");
    const [error] = codex.errors;

    expect(error?.message).toContain("codex stdout line 2");
    expect(error?.message).toContain("thread/started");
  });
});

describe("correlating a request with its answer", () => {
  it("settles the request the result names", async () => {
    const codex = harness();

    const pending = codex.client.request("account/read", {}, AnyResult);
    await setImmediate();
    await feed(codex.stdout, '{"id":1,"result":{"account":null,"requiresOpenaiAuth":true}}\n');

    expect(codex.written).toEqual(['{"id":1,"method":"account/read","params":{}}\n']);
    expect(await pending).toEqual({ account: null, requiresOpenaiAuth: true });
  });

  it("fails the request with the code and message the server sent", async () => {
    const codex = harness();

    const failure = refusal(codex.client.request("account/read", {}, AnyResult));
    await setImmediate();
    await feed(
      codex.stdout,
      '{"error":{"code":-32600,"message":"Invalid request: missing field `params`"},"id":1}\n',
    );
    const error = await failure;

    expect(error.code).toBe(-32_600);
    expect(error.message).toBe("Invalid request: missing field `params`");
  });
});

describe("answering a request the server sends", () => {
  it("answers on the same stream with the id in the type it arrived as", async () => {
    const codex = harness();

    await feed(
      codex.stdout,
      '{"id":"srv-4","method":"item/tool/requestUserInput","params":{"itemId":"i1"}}\n',
    );
    codex.client.respond("srv-4", { answers: {} });
    await setImmediate();

    expect(codex.requests).toEqual([
      {
        kind: "request",
        id: "srv-4",
        method: "item/tool/requestUserInput",
        params: { itemId: "i1" },
      },
    ]);
    expect(codex.written).toEqual(['{"id":"srv-4","result":{"answers":{}}}\n']);
  });
});

describe("reading the log records on stderr", () => {
  it("surfaces the message of an ERROR record", async () => {
    const codex = harness();

    await feed(
      codex.stderr,
      "2026-09-22T15:27:45.209218Z  ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized\n",
    );

    expect(codex.records).toEqual(["failed to connect to websocket: HTTP error: 401 Unauthorized"]);
  });

  it("drops the sandbox warning Codex prints at every start", async () => {
    const codex = harness();

    await feed(
      codex.stderr,
      "\u001b[2m2026-09-22T15:27:43.211230Z\u001b[0m \u001b[31mERROR\u001b[0m \u001b[2mcodex_app_server\u001b[0m\u001b[2m:\u001b[0m Codex's Linux sandbox uses bubblewrap and needs access to create user namespaces.\n",
    );

    expect(codex.records).toEqual([]);
  });
});
