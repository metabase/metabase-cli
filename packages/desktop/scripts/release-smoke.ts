import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { stringify } from "yaml";

import { errorMessage } from "@metabase/client/errors";

import { UPDATE_FEED_ENV_VAR } from "../src/main/updates";

import {
  DriverFailure,
  WINDOW_TIMEOUT_MS,
  appTarget,
  closeApp,
  definedEnv,
  evidenceDir,
  killSurvivors,
  launchApp,
  timestamp,
} from "./app";
import { noteTo, temporaryDir, type Note } from "./scenario";

const UNIT = "u8";
const OFFERED_VERSION = "9.9.9";
const LOOPBACK = "127.0.0.1";
const MANIFEST_PATH = /^\/latest-linux(?:-[a-z0-9]+)?\.yml$/u;
// electron-updater appends a cache-busting query to every manifest request.
const QUERY = /\?.*$/u;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const YAML_TYPE = "text/yaml";
const BINARY_TYPE = "application/octet-stream";
const AVAILABLE_TEXT = `RDE ${OFFERED_VERSION} is available.`;
const READY_TEXT = `RDE ${OFFERED_VERSION} is ready. Restart to update.`;

// electron-updater keeps a downloaded update under the user's cache directory; a temporary one
// keeps the smoke's download off the machine's.
const CACHE_HOME_ENV_VAR = "XDG_CACHE_HOME";

// The download is the whole AppImage, so it outlasts a click.
const DOWNLOAD_TIMEOUT_MS = 180_000;

interface OfferedFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly sha512: string;
}

// The offered update is the AppImage under test renamed, so a download has real bytes to verify.
async function offeredFile(executable: string): Promise<OfferedFile> {
  const bytes = await readFile(executable);
  return {
    name: `metabase-rde-${OFFERED_VERSION}.AppImage`,
    path: executable,
    size: bytes.length,
    sha512: createHash("sha512").update(bytes).digest("base64"),
  };
}

function manifest(file: OfferedFile): string {
  return stringify({
    version: OFFERED_VERSION,
    files: [{ url: file.name, sha512: file.sha512, size: file.size }],
    path: file.name,
    sha512: file.sha512,
    releaseDate: new Date().toISOString(),
  });
}

async function serveFeed(file: OfferedFile, note: Note): Promise<Server> {
  const body = manifest(file);
  const server = createServer((request, response) => {
    const url = request.url;
    void note(`mock feed: ${String(request.method)} ${String(url)}`);
    if (url === undefined) {
      response.writeHead(HTTP_NOT_FOUND);
      response.end();
      return;
    }
    const path = url.replace(QUERY, "");
    if (MANIFEST_PATH.test(path)) {
      response.writeHead(HTTP_OK, { "content-type": YAML_TYPE });
      response.end(body);
      return;
    }
    if (path === `/${file.name}`) {
      response.writeHead(HTTP_OK, { "content-type": BINARY_TYPE, "content-length": file.size });
      createReadStream(file.path).pipe(response);
      return;
    }
    response.writeHead(HTTP_NOT_FOUND);
    response.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, LOOPBACK, resolve);
  });
  return server;
}

function feedUrl(server: Server): string {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") {
    throw new DriverFailure("the mock feed is not listening on a port");
  }
  return `http://${LOOPBACK}:${String(address.port)}/`;
}

async function main(): Promise<void> {
  const target = appTarget(process.env);
  if (target.kind !== "packaged") {
    throw new DriverFailure("the release smoke runs the packaged app; set RDE_PACKAGED_APP");
  }
  const dir = await evidenceDir(process.env);
  const note = noteTo(join(dir, `${timestamp()}_${UNIT}-update.log`));
  await note("bun scripts/release-smoke.ts");
  await note(`the app under test: ${target.executable}`);

  const file = await offeredFile(target.executable);
  const server = await serveFeed(file, note);
  const feed = feedUrl(server);
  await note(`the mock feed offers ${OFFERED_VERSION} at ${feed}`);

  try {
    const running = await launchApp({
      userDataDir: await temporaryDir("rde-release-smoke-"),
      extraArgs: [],
      env: definedEnv({
        ...process.env,
        [UPDATE_FEED_ENV_VAR]: feed,
        [CACHE_HOME_ENV_VAR]: await temporaryDir("rde-release-cache-"),
      }),
    });
    const window = await running.app.firstWindow({ timeout: WINDOW_TIMEOUT_MS });
    const toast = window.getByRole("status").filter({ hasText: AVAILABLE_TEXT });
    await toast.waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
    await note(`the toast: ${await toast.innerText()}`);
    const available = join(dir, `${timestamp()}_${UNIT}-update.png`);
    await window.screenshot({ path: available });
    await note(`the offer: ${available}`);

    await toast.getByRole("button", { name: "Download" }).click();
    const ready = window.getByRole("status").filter({ hasText: READY_TEXT });
    await ready.waitFor({ state: "visible", timeout: DOWNLOAD_TIMEOUT_MS });
    await note(`the toast after Download: ${await ready.innerText()}`);
    const downloaded = join(dir, `${timestamp()}_${UNIT}-update-ready.png`);
    await window.screenshot({ path: downloaded });
    await note(`the download, verified against the manifest's sha512: ${downloaded}`);

    await closeApp(running);
    process.stdout.write(`release smoke ok: ${available}, ${downloaded}\n`);
  } catch (error) {
    await note(`FAILED: ${errorMessage(error)}`);
    await killSurvivors();
    throw error;
  } finally {
    server.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`release smoke failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
