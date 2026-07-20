import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { ConfigError } from "../errors";

const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";
const DEFAULT_TIMEOUT_MS = 300_000;

export interface CallbackParams {
  code: string;
  state: string;
}

export interface CallbackServer {
  redirectUri: string;
  waitForCallback(): Promise<CallbackParams>;
  close(): void;
}

interface QueryResult {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

function parseCallbackQuery(rawUrl: string): QueryResult {
  const queryStart = rawUrl.indexOf("?");
  const params = new URLSearchParams(queryStart === -1 ? "" : rawUrl.slice(queryStart + 1));
  return {
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
    errorDescription: params.get("error_description"),
  };
}

function isCallbackPath(rawUrl: string): boolean {
  const queryStart = rawUrl.indexOf("?");
  const path = queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);
  return path === CALLBACK_PATH;
}

// The message can carry attacker-controlled query content (error_description from the redirect),
// so everything interpolated into the page is escaped.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlPage(title: string, message: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
    escapeHtml(title) +
    '</title></head><body style="font-family:system-ui;text-align:center;padding-top:4rem;color:#4c5773">' +
    "<h1>" +
    escapeHtml(title) +
    "</h1><p>" +
    escapeHtml(message) +
    "</p><p>You can close this tab and return to your terminal.</p></body></html>"
  );
}

function respond(res: ServerResponse, status: number, title: string, message: string): void {
  // Close the socket after responding so a browser's keep-alive connection can't keep the loopback
  // server (and the CLI process) alive after server.close().
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", connection: "close" });
  res.end(htmlPage(title, message));
}

function serverPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new ConfigError("could not determine loopback callback port");
  }
  const info: AddressInfo = address;
  return info.port;
}

// Bind an ephemeral loopback port and resolve once the browser redirect hits /callback with the
// expected state. RFC 8252 native-app flow: the redirect URI is http://127.0.0.1:<port>/callback.
export function startCallbackServer(
  expectedState: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let settle: ((params: CallbackParams) => void) | null = null;
    let fail: ((error: Error) => void) | null = null;
    let outcome: CallbackParams | Error | null = null;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const rawUrl = req.url ?? "";
      if (!isCallbackPath(rawUrl)) {
        respond(res, 404, "Not found", "Unexpected request.");
        return;
      }
      const query = parseCallbackQuery(rawUrl);
      // Validate state in the handler, before consuming the one-shot callback slot: a forged or
      // stray loopback request (any local process can spray ports) must not abort the pending
      // login or render a success page. Reject it and keep waiting for the genuine redirect.
      if (query.state !== expectedState) {
        respond(res, 400, "Login failed", "Invalid or missing state.");
        return;
      }
      if (query.error !== null) {
        const detail = query.errorDescription ?? query.error;
        respond(res, 400, "Login failed", detail);
        deliver(new ConfigError(`authorization denied: ${detail}`));
        return;
      }
      if (query.code === null) {
        respond(res, 400, "Login failed", "Missing authorization code.");
        deliver(new ConfigError("authorization callback missing code"));
        return;
      }
      respond(res, 200, "Login complete", "Metabase CLI is now authorized.");
      deliver({ code: query.code, state: query.state });
    });

    function deliver(result: CallbackParams | Error): void {
      if (outcome !== null) {
        return;
      }
      outcome = result;
      if (result instanceof Error) {
        fail?.(result);
      } else {
        settle?.(result);
      }
    }

    const timer = setTimeout(() => {
      deliver(new ConfigError(`timed out waiting for browser login after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    server.on("error", (error) => {
      // Before listen resolves this fails startup; after, it aborts the pending login instead of
      // stalling silently until the timeout fires.
      rejectServer(error);
      deliver(error);
    });
    server.listen(0, LOOPBACK_HOST, () => {
      const port = serverPort(server);
      resolveServer({
        redirectUri: `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`,
        waitForCallback() {
          return new Promise<CallbackParams>((resolve, reject) => {
            if (outcome !== null) {
              if (outcome instanceof Error) {
                reject(outcome);
              } else {
                resolve(outcome);
              }
              return;
            }
            settle = resolve;
            fail = reject;
          });
        },
        close() {
          clearTimeout(timer);
          server.close();
          // A browser's lingering keep-alive socket would otherwise hold the event loop (and the
          // CLI process) open after close().
          server.closeAllConnections();
        },
      });
    });
  });
}
