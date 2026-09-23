import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { Page } from "playwright";

import type { E2EBootstrap } from "../../../../tests/e2e/bootstrap-data";
import { SessionEnvironment } from "../../src/contracts/connection";
import { DriverFailure, WINDOW_TIMEOUT_MS, closeApp, definedEnv, timestamp } from "../app";
import {
  THEME_ENV_VAR,
  chooseRepository,
  expectVisible,
  openSettings,
  openWindow,
  seedRepository,
  start,
  temporaryDir,
  type Note,
  type Scenario,
} from "../scenario";

const UNIT = "u2";

const CLI_ENTRY = resolve(import.meta.dirname, "..", "..", "..", "cli", "dist", "cli.mjs");
const CLI_TIMEOUT_MS = 60_000;
const BROKER_UNAUTHORIZED_TEXT = "the RDE broker rejected this session's token (401)";

const AGENT_LABELS = ["Claude Code", "Codex"] as const;

const run = promisify(execFile);

interface ShotSection {
  readonly nav: string;
  readonly slug: string;
}

const SHOT_SECTIONS: readonly ShotSection[] = [
  { nav: "Metabase", slug: "connection" },
  { nav: "Agents", slug: "agents" },
];

export async function signIn(window: Page, bootstrap: E2EBootstrap, note: Note): Promise<void> {
  await window.getByLabel("Metabase URL").fill(bootstrap.baseUrl);
  await note(`typed ${bootstrap.baseUrl}`);
  await window.getByRole("button", { name: "Check URL" }).click();
  const useApiKey = window.getByRole("button", { name: "Use an API key instead", exact: true });
  await useApiKey.waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
  await useApiKey.click();
  await note("the server offered the browser sign-in; chose an API key instead");
  await window.getByLabel("API key").fill(bootstrap.adminApiKey);
  await window.getByRole("button", { name: "Sign in", exact: true }).click();
  await note("clicked Sign in");
}

const SETTINGS_CONNECT: Scenario = {
  name: "settings-connect",
  unit: UNIT,
  gate: null,
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const theme = process.env[THEME_ENV_VAR];
    const seeded = await bootstrap();
    const repositoryPath = await seedRepository();
    const running = await start(await temporaryDir("rde-userdata-"), theme);
    const window = await openWindow(running, onWindow);

    await expectVisible(window, "Finish setting up");
    await note("the main area opened on the onboarding checklist");

    await openSettings(window, note);
    await signIn(window, seeded, note);
    await expectVisible(window, seeded.adminApiKeyEmail);
    await note(`signed in to ${seeded.baseUrl} as ${seeded.adminApiKeyEmail}`);

    await window.getByRole("button", { name: "Repository", exact: true }).click();
    await chooseRepository(window, repositoryPath);
    await expectVisible(window, repositoryPath);
    await note(`repository ${repositoryPath}`);

    await window.getByRole("button", { name: "Agents", exact: true }).click();
    await window.getByRole("button", { name: "Rescan" }).click();
    await window
      .getByRole("status")
      .filter({ hasText: "Scanning" })
      .waitFor({ state: "hidden", timeout: WINDOW_TIMEOUT_MS });
    for (const label of AGENT_LABELS) {
      const row = window.locator("li", { hasText: label }).first();
      await row.waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
      await note(`${label} row:\n${await row.innerText()}`);
    }

    const suffix = theme === "dark" ? "-dark" : "";
    const shots: string[] = [];
    for (const section of SHOT_SECTIONS) {
      await window.getByRole("button", { name: section.nav, exact: true }).click();
      const path = join(dir, `${timestamp()}_${UNIT}-settings-${section.slug}${suffix}.png`);
      await window.screenshot({ path });
      shots.push(path);
      await note(`${section.nav} in view: ${path}`);
    }
    await closeApp(running);
    return shots.join(", ");
  },
};

interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function cliEnvironment(session: SessionEnvironment): Record<string, string> {
  return definedEnv({
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    MB_URL: session.MB_URL,
    MB_AUTH_BROKER: session.MB_AUTH_BROKER,
    MB_AUTH_BROKER_TOKEN: session.MB_AUTH_BROKER_TOKEN,
  });
}

async function runCliThroughBroker(session: SessionEnvironment): Promise<CliRun> {
  const env = cliEnvironment(session);
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [CLI_ENTRY, "search", "--json", "--limit", "1"],
      { env, timeout: CLI_TIMEOUT_MS },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (error instanceof Error && "code" in error && "stdout" in error && "stderr" in error) {
      return {
        code: Number(error.code),
        stdout: String(error.stdout),
        stderr: String(error.stderr),
      };
    }
    throw error;
  }
}

const BROKER: Scenario = {
  name: "broker",
  unit: UNIT,
  gate: null,
  act: async ({ bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await openSettings(window, note);
    await signIn(window, seeded, note);
    await expectVisible(window, seeded.adminApiKeyEmail);
    await note(`signed in to ${seeded.baseUrl} through the app`);

    const minted: unknown = await window.evaluate("window.rde.testSessionMint()");
    const session = SessionEnvironment.parse(minted);
    await note(`session ${session.sessionId} broker ${session.MB_AUTH_BROKER}`);
    await note(
      `the CLI's environment carries only: ${Object.keys(cliEnvironment(session)).toSorted().join(", ")}`,
    );

    const granted = await runCliThroughBroker(session);
    await note(`mb search --json --limit 1 exit ${granted.code}`);
    await note(granted.stdout.trim());
    if (granted.code !== 0) {
      throw new DriverFailure(`the brokered command failed: ${granted.stderr.trim()}`);
    }

    await window.evaluate(
      `window.rde.testSessionRevoke({ sessionId: ${JSON.stringify(session.sessionId)} })`,
    );
    const revoked = await runCliThroughBroker(session);
    await note(`after revoking the session, exit ${revoked.code}: ${revoked.stderr.trim()}`);
    if (revoked.code === 0 || !revoked.stderr.includes(BROKER_UNAUTHORIZED_TEXT)) {
      throw new DriverFailure(
        `a revoked session still ran: exit ${revoked.code} ${revoked.stderr.trim()}`,
      );
    }

    await closeApp(running);
    return "the transcript beside this run";
  },
};

export const SETTINGS_SCENARIOS: readonly Scenario[] = [SETTINGS_CONNECT, BROKER];
