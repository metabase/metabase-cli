import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { recordGateSkip } from "../../../../tests/e2e/server-gate";

import { DriverFailure, appTarget, closeApp, timestamp } from "../app";
import {
  TURN_TIMEOUT_MS,
  openWindow,
  start,
  stopEverySession,
  temporaryDir,
  type Scenario,
} from "../scenario";

import { connectAndStart, noteTools } from "./metabase";

const UNIT = "u8";

const PACKAGED_APP_MISSING =
  "RDE_PACKAGED_APP names no packaged build; run `bun run dist:desktop:linux` and point it at the AppImage";

const CLI_PROMPT =
  'Run exactly these four shell commands, one at a time, and nothing else: `command -v mb`, then `mb --version`, then `mb skills path core`, then `echo "$RDE_NODE"`. Then stop.';

const CLI_RESOURCE_DIR = "rde-cli";

const CLI_MANIFEST = join(import.meta.dirname, "..", "..", "..", "cli", "package.json");

const CliManifest = z.object({ version: z.string() });

async function cliVersion(): Promise<string> {
  return parseJson(await readFile(CLI_MANIFEST, "utf8"), CliManifest).version;
}

interface PackagedRuntime {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly execPath: string;
}

const PACKAGED_CLI: Scenario = {
  name: "packaged",
  unit: UNIT,
  gate: (lane) => {
    if (appTarget(process.env).kind === "packaged") {
      return null;
    }
    recordGateSkip(lane, PACKAGED_APP_MISSING);
    return PACKAGED_APP_MISSING;
  },
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const runtime: PackagedRuntime = await running.app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      execPath: process.execPath,
    }));
    await note(`the app under test: ${JSON.stringify(runtime)}`);
    if (!runtime.isPackaged) {
      throw new DriverFailure("the app under test is not packaged; set RDE_PACKAGED_APP");
    }
    const window = await openWindow(running, onWindow);

    const session = await connectAndStart(window, note, seeded, CLI_PROMPT, TURN_TIMEOUT_MS);
    await note(`session ${session.id} in ${session.workspace.path}`);
    const tools = await noteTools(window, session.id, note);
    const cliRoot = join(runtime.resourcesPath, CLI_RESOURCE_DIR);
    const expected = [
      join(cliRoot, "bin", "mb"),
      await cliVersion(),
      join(cliRoot, "skill-data", "core"),
      runtime.execPath,
    ];
    for (const text of expected) {
      if (!tools.includes(text)) {
        throw new DriverFailure(`the agent's shell output never names ${text}`);
      }
    }
    const shot = join(dir, `${timestamp()}_${UNIT}-packaged.png`);
    await window.screenshot({ path: shot });
    await note(`the session in the packaged app: ${shot}`);

    await stopEverySession(window);
    await closeApp(running);
    return shot;
  },
};

export const PACKAGING_SCENARIOS: readonly Scenario[] = [PACKAGED_CLI];
