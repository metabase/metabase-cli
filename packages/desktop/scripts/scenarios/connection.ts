import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "playwright";

import { OAUTH_SCOPE } from "@metabase/client/http/oauth";

import type { E2EBootstrap } from "../../../../tests/e2e/bootstrap-data";

import { OpenedExternally } from "../../src/contracts/changes";
import type { SessionEvent } from "../../src/contracts/events";
import {
  SESSION_STORE_VERSION,
  type SessionIndex,
  type SessionIndexEntry,
} from "../../src/contracts/session";
import { EVENTS_FILE_NAME } from "../../src/main/sessions/log";
import { INDEX_FILE_NAME, SESSIONS_DIR_NAME } from "../../src/main/sessions/store";
import { DriverFailure, WINDOW_TIMEOUT_MS, closeApp } from "../app";
import { approveConsent } from "../consent";
import {
  THEME_ENV_VAR,
  chooseRepository,
  closeSettings,
  expectVisible,
  git,
  openSettings,
  openWindow,
  requireLine,
  seedRepository,
  shoot,
  start,
  temporaryDir,
  type Note,
  type Scenario,
} from "../scenario";

import { startOAuthFront, type OAuthFront } from "./oauth-front";

const UNIT = "u9";
const CONNECT_UNIT = "u16";
const THEMES = ["light", "dark"] as const;

const SESSION_ID = "ses_connection";
const SESSION_TITLE = "Connection states";
const SESSION_BRANCH = "main";

const CALLBACK_TIMEOUT_MS = 30_000;
const OPENED_POLL_MS = 100;

type Theme = (typeof THEMES)[number];

async function writeInPlaceSession(userDataDir: string, repositoryPath: string): Promise<void> {
  const root = join(userDataDir, SESSIONS_DIR_NAME);
  await mkdir(join(root, SESSION_ID), { recursive: true });
  const head = requireLine(await git(repositoryPath, "rev-parse", "HEAD"), "HEAD");
  const at = new Date().toISOString();
  const created: Extract<SessionEvent, { type: "session.created" }> = {
    id: "evt_0",
    sessionId: SESSION_ID,
    seq: 0,
    at,
    type: "session.created",
    title: SESSION_TITLE,
    provider: "claude",
    model: null,
    workspace: { kind: "in-place", path: repositoryPath, branch: SESSION_BRANCH, head },
    permissionMode: "ask",
  };
  await writeFile(join(root, SESSION_ID, EVENTS_FILE_NAME), `${JSON.stringify(created)}\n`, "utf8");
  await git(repositoryPath, "update-ref", `refs/rde/checkpoints/${SESSION_ID}/0`, head);
  const entry: SessionIndexEntry = {
    id: SESSION_ID,
    title: SESSION_TITLE,
    provider: "claude",
    workspace: created.workspace,
    lifecycle: "active",
    pinned: false,
    createdAt: at,
    updatedAt: at,
  };
  const index: SessionIndex = { version: SESSION_STORE_VERSION, sessions: [entry] };
  await writeFile(join(root, INDEX_FILE_NAME), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

function metabaseCard(window: Page): Locator {
  return window.getByRole("region", { name: "Metabase", exact: true });
}

function hostOf(front: OAuthFront): string {
  return front.url.replace("http://", "");
}

async function openedUrls(window: Page): Promise<readonly string[]> {
  return OpenedExternally.parse(await window.evaluate("window.rde.testOpenedExternally()")).urls;
}

async function awaitAuthorizeUrl(window: Page, origin: string, seen: number): Promise<string> {
  const deadline = Date.now() + WINDOW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const fresh = (await openedUrls(window)).slice(seen);
    const authorize = fresh.find((url) => url.startsWith(origin));
    if (authorize !== undefined) {
      return authorize;
    }
    await window.waitForTimeout(OPENED_POLL_MS);
  }
  throw new DriverFailure(`the app opened no authorize URL at ${origin}`);
}

// The person's browser follows the front's redirect to the app's loopback callback, which is
// what finishes the grant.
async function signInThroughFront(
  window: Page,
  front: OAuthFront,
  action: string,
  note: Note,
): Promise<void> {
  await openSettings(window, note);
  await window.getByRole("button", { name: "Metabase", exact: true }).click();
  const card = metabaseCard(window);
  await card.getByLabel("Metabase URL").fill(front.url);
  await card.getByRole("button", { name: "Check URL" }).click();
  const seen = (await openedUrls(window)).length;
  await card.getByRole("button", { name: action, exact: true }).click();
  const authorize = await awaitAuthorizeUrl(window, front.url, seen);
  await note(`the app handed the browser ${authorize}`);
  const callback = await fetch(authorize, {
    redirect: "follow",
    signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
  });
  await note(`the loopback callback answered ${callback.status} at ${callback.url}`);
  if (!callback.ok) {
    throw new DriverFailure(`the loopback callback refused the grant: ${await callback.text()}`);
  }
  await card.getByRole("button", { name: "Sign out", exact: true }).waitFor({ state: "visible" });
  await note(`clicked ${action}; Settings > Metabase reads:\n${await card.innerText()}`);
}

async function awaitExpiry(window: Page, front: OAuthFront, note: Note): Promise<void> {
  const expiresAt = front.expiresAt();
  if (expiresAt === null) {
    throw new DriverFailure("the front has issued no access token");
  }
  const remaining = expiresAt - Date.now();
  if (remaining > 0) {
    await window.waitForTimeout(remaining);
  }
  await note(`the access token expired at ${new Date(expiresAt).toISOString()}`);
}

// Mounting the Metabase tab reads the session's sync status through the bundled `mb`, which asks
// the broker for a token, so an expired one is renewed right then.
// The panel asks nothing of an instance without remote sync, so the token is spent the way the
// panel's Try again spends it.
async function askForToken(window: Page, note: Note): Promise<void> {
  await window.evaluate("window.rde.connectionRefresh()");
  await note("asked the connection to renew its token");
}

// The session's sections appear once its `mb` call has answered, so the panel is shot settled
// rather than halfway through that call.
async function settledPanel(window: Page): Promise<string> {
  const panel = sidePanel(window);
  await panel
    .getByRole("region", { name: "This branch in Metabase" })
    .waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
  return panel.innerText();
}

async function shootState(
  window: Page,
  dir: string,
  theme: Theme,
  state: string,
  note: Note,
): Promise<string> {
  const path = await shoot(window, dir, UNIT, `audit-${theme}-${state}`);
  await note(`${state}: ${path}`);
  return path;
}

async function shootBrokenState(
  window: Page,
  dir: string,
  theme: Theme,
  state: string,
  note: Note,
): Promise<string[]> {
  await note(`the Metabase panel reads:\n${await settledPanel(window)}`);
  const withPanel = await shootState(window, dir, theme, state, note);
  await openSettings(window, note);
  await window.getByRole("button", { name: "Metabase", exact: true }).click();
  await note(`Settings > Metabase reads:\n${await metabaseCard(window).innerText()}`);
  const settings = await shootState(window, dir, theme, `${state}-settings`, note);
  await closeSettings(window);
  return [withPanel, settings];
}

async function driveTheme(
  theme: Theme,
  dir: string,
  front: OAuthFront,
  note: Note,
  onWindow: (window: Page) => void,
): Promise<string[]> {
  const host = hostOf(front);
  const repositoryPath = await seedRepository();
  const userDataDir = await temporaryDir("rde-userdata-");
  await writeInPlaceSession(userDataDir, repositoryPath);
  await note(`${theme}: front ${front.url}, repository ${repositoryPath}, session ${SESSION_ID}`);
  const running = await start(userDataDir, theme);
  const window = await openWindow(running, onWindow);

  await openSettings(window, note);
  await window.getByRole("button", { name: "Repository", exact: true }).click();
  await chooseRepository(window, repositoryPath);
  await expectVisible(window, repositoryPath);
  await closeSettings(window);
  await note(`picked the repository ${repositoryPath}`);

  await signInThroughFront(window, front, "Sign in", note);
  await closeSettings(window);
  await window.getByRole("button", { name: SESSION_TITLE }).click();
  await sidePanel(window).getByRole("tab", { name: "Metabase", exact: true }).click();
  await expectVisible(window, host);
  await note(`the Metabase panel reads:\n${await settledPanel(window)}`);
  const connected = await shootState(window, dir, theme, "connected", note);

  front.answerRefreshes("refuse");
  await note("the front refuses every refresh with 400 invalid_grant");
  await awaitExpiry(window, front, note);
  await askForToken(window, note);
  await expectVisible(window, "Signed out of Metabase");
  await note(`the sidebar reads "Signed out of Metabase"`);
  const signedOut = await shootBrokenState(window, dir, theme, "signed-out", note);

  front.answerRefreshes("grant");
  await note("the front grants refreshes again");
  await signInThroughFront(window, front, "Sign in again", note);
  await closeSettings(window);
  await expectVisible(window, host);

  await front.stopAnswering();
  await note("the front closed its listener, so nothing answers at its address");
  await awaitExpiry(window, front, note);
  await askForToken(window, note);
  await expectVisible(window, "Can't reach Metabase");
  await note(`the sidebar reads "Can't reach Metabase"`);
  const stale = await shootBrokenState(window, dir, theme, "stale", note);

  await closeApp(running);
  return [connected, ...signedOut, ...stale];
}

const CONNECTION_STATES: Scenario = {
  name: "connection-states",
  unit: UNIT,
  gate: null,
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const shots: string[] = [];
    for (const theme of THEMES) {
      const front = await startOAuthFront(seeded);
      try {
        shots.push(...(await driveTheme(theme, dir, front, note, onWindow)));
      } finally {
        await front.stopAnswering();
      }
    }
    return shots.join(", ");
  },
};

function isTheme(value: string): value is Theme {
  return THEMES.some((theme) => theme === value);
}

function chosenThemes(): readonly Theme[] {
  const chosen = process.env[THEME_ENV_VAR];
  if (chosen === undefined) {
    return THEMES;
  }
  if (!isTheme(chosen)) {
    throw new DriverFailure(`${THEME_ENV_VAR} names no theme this scenario shoots: ${chosen}`);
  }
  return [chosen];
}

// The probe's answer is shot before it is judged, so a run that finds no browser sign-in still
// leaves the card that says why.
async function connectThroughConsent(
  theme: Theme,
  dir: string,
  bootstrap: E2EBootstrap,
  note: Note,
  onWindow: (window: Page) => void,
): Promise<string[]> {
  const running = await start(await temporaryDir("rde-userdata-"), theme);
  const window = await openWindow(running, onWindow);
  await openSettings(window, note);
  await window.getByRole("button", { name: "Metabase", exact: true }).click();
  const card = metabaseCard(window);
  await card.getByLabel("Metabase URL").fill(bootstrap.baseUrl);
  await card.getByRole("button", { name: "Check URL" }).click();
  const signIn = card.getByRole("button", { name: "Sign in", exact: true });
  await signIn.waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
  await note(
    `${theme}: checked ${bootstrap.baseUrl}; Settings > Metabase reads:\n${await card.innerText()}`,
  );
  const probed = await shoot(window, dir, CONNECT_UNIT, `connect-${theme}`);
  await note(`the probe's answer: ${probed}`);
  if (await card.getByLabel("API key").isVisible()) {
    throw new DriverFailure(`the probe offered no browser sign-in: ${await card.innerText()}`);
  }

  const seen = (await openedUrls(window)).length;
  await signIn.click();
  const authorize = await awaitAuthorizeUrl(window, bootstrap.baseUrl, seen);
  await note(`the app handed the browser ${authorize}`);
  const answer = await approveConsent(bootstrap, authorize);
  await note(`the admin approved ${OAUTH_SCOPE}; the callback answered ${answer.status}`);
  await card
    .getByRole("button", { name: "Sign out", exact: true })
    .waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
  await expectVisible(window, bootstrap.admin.email);
  await note(
    `signed in as ${bootstrap.admin.email}; Settings > Metabase reads:\n${await card.innerText()}`,
  );
  const signedIn = await shoot(window, dir, CONNECT_UNIT, `connect-signed-in-${theme}`);
  await note(`signed in: ${signedIn}`);
  await closeApp(running);
  return [probed, signedIn];
}

const OAUTH_CONNECT: Scenario = {
  name: "oauth-connect",
  unit: CONNECT_UNIT,
  gate: null,
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const shots: string[] = [];
    for (const theme of chosenThemes()) {
      shots.push(...(await connectThroughConsent(theme, dir, seeded, note, onWindow)));
    }
    return shots.join(", ");
  },
};

export const CONNECTION_SCENARIOS: readonly Scenario[] = [CONNECTION_STATES, OAUTH_CONNECT];
