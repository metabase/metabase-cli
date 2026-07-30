import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCliInterrupt } from "./run-cli";

// Ctrl-C exits 130 only while something is still in flight, and a real Metabase answers a local
// request in milliseconds — far too fast to interrupt without a race. These stubs stand in for a
// slow peer, not for Metabase: the CLI under test is the built binary, unmodified, and every
// assertion is about its own signal handling.
const INTERRUPT_EXIT_CODE = 130;
const INTERRUPT_AFTER_MS = 1_500;
const POLL_INTERVAL_MS = 200;

type StubHandler = (request: IncomingMessage, response: ServerResponse) => void;

interface StubServer {
  url: string;
  server: Server;
}

async function startStub(handler: StubHandler): Promise<StubServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(`stub server did not bind a TCP port: ${String(address)}`);
  }
  return { url: `http://127.0.0.1:${address.port}`, server };
}

async function stopStub(stub: StubServer): Promise<void> {
  stub.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    stub.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

describe("SIGINT handling (end-to-end)", () => {
  const tempDirs: string[] = [];
  const stubs: StubServer[] = [];

  afterEach(async () => {
    await Promise.all(stubs.splice(0).map(stopStub));
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  async function stubServer(handler: StubHandler): Promise<StubServer> {
    const stub = await startStub(handler);
    stubs.push(stub);
    return stub;
  }

  it("aborts an in-flight request and exits 130", async () => {
    const stub = await stubServer(() => {
      // Accept the request and never answer it, so the CLI is still waiting when SIGINT lands.
    });

    const result = await runCliInterrupt({
      args: ["card", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: { MB_URL: stub.url, MB_API_KEY: "mb_e2e_interrupt_key" },
      interruptAfterMs: INTERRUPT_AFTER_MS,
    });

    expect(result.exitCode).toBe(INTERRUPT_EXIT_CODE);
    expect(cliErrorCategory(result.stderr)).toBe("abort");
    expect(cliErrorMessage(result.stderr)).toBe("interrupted");
  });

  it("aborts a --wait poll loop and exits 130", async () => {
    const stub = await stubServer((request, response) => {
      if (request.method === "POST") {
        sendJson(response, { status: "ok" });
        return;
      }
      sendJson(response, { id: 1, name: "stub", initial_sync_status: "incomplete" });
    });

    const result = await runCliInterrupt({
      args: ["db", "sync-schema", "1", "--wait", "--interval", String(POLL_INTERVAL_MS), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: { MB_URL: stub.url, MB_API_KEY: "mb_e2e_interrupt_key" },
      interruptAfterMs: INTERRUPT_AFTER_MS,
    });

    expect(result.exitCode).toBe(INTERRUPT_EXIT_CODE);
    expect(cliErrorCategory(result.stderr)).toBe("abort");
    expect(cliErrorMessage(result.stderr)).toBe("interrupted");
  });
});
