import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "playwright";

import { requireServer } from "../../../../tests/e2e/server-gate";

import { MetabasePanelState } from "../../src/contracts/metabase";
import { SessionIndex, SessionSnapshot, type SessionIndexEntry } from "../../src/contracts/session";
import { DriverFailure, closeApp } from "../app";
import {
  chooseOption,
  closeSettings,
  TURN_TIMEOUT_MS,
  WORKTREE_OPTION,
  git,
  openSettings,
  openWindow,
  pointAtWorktreeRoot,
  seedRepository,
  start,
  startSession,
  stopEverySession,
  temporaryDir,
  type Note,
  type Scenario,
  shoot,
} from "../scenario";

import { signIn } from "./settings";

const UNIT = "u7";

const ALL_PERMISSIONS = "Skip every check";

const SKILLS_PROMPT =
  "Run exactly these two shell commands, one at a time, and nothing else: `command -v mb`, then `mb skills list --json`. Then reply with the skill names the second one listed as available and stop.";

const SEGMENT_PROMPT =
  "Add a segment on ORDERS for orders over 100, validate it, sync it to Metabase and confirm it exists.";

// The whole loop is many tool calls, each a model round trip.
const AGENT_LOOP_TIMEOUT_MS = 15 * 60_000;

const SYNC_LABELS = /^(Sync to Metabase|Push and sync)$/u;

const IGNORED_DIRECTORIES = [".metadata/", ".scratch/"];

const REPO_FIRST_SKILLS = ["core", "metabase-representation-format", "metabase-database-metadata"];

async function seedOrigin(repositoryPath: string): Promise<string> {
  const bare = await temporaryDir("rde-origin-");
  await git(bare, "init", "--quiet", "--bare", "--initial-branch=main");
  await git(repositoryPath, "remote", "add", "origin", bare);
  await git(repositoryPath, "push", "--quiet", "--set-upstream", "origin", "main");
  return bare;
}

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

async function newestSession(window: Page): Promise<SessionIndexEntry> {
  const entry = SessionIndex.parse(await window.evaluate("window.rde.sessionsList()")).sessions[0];
  if (entry === undefined) {
    throw new DriverFailure("the app recorded no session");
  }
  return entry;
}

async function openSnapshot(window: Page, sessionId: string): Promise<SessionSnapshot> {
  return SessionSnapshot.parse(
    await window.evaluate(`window.rde.sessionsOpen({ sessionId: ${JSON.stringify(sessionId)} })`),
  );
}

async function panelState(window: Page, sessionId: string): Promise<MetabasePanelState> {
  return MetabasePanelState.parse(
    await window.evaluate(`window.rde.metabasePanel({ sessionId: ${JSON.stringify(sessionId)} })`),
  );
}

const CHECKPOINT_POLL_MS = 1000;

// A long turn scrolls its checkpoint row out of the virtualised list, so the snapshot is what says
// the turn has settled.
async function awaitCheckpoint(window: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = SessionIndex.parse(await window.evaluate("window.rde.sessionsList()"))
      .sessions[0];
    if (session !== undefined) {
      const snapshot = await openSnapshot(window, session.id);
      if (snapshot.items.some((item) => item.kind === "checkpoint")) {
        return;
      }
    }
    await window.waitForTimeout(CHECKPOINT_POLL_MS);
  }
  throw new DriverFailure(`no turn settled into a checkpoint within ${timeoutMs} ms`);
}

export async function noteTools(window: Page, sessionId: string, note: Note): Promise<string> {
  const snapshot = await openSnapshot(window, sessionId);
  const lines: string[] = [];
  for (const item of snapshot.items) {
    if (item.kind === "tool") {
      lines.push(`$ ${item.label}\n${item.output.trimEnd()}`);
    }
  }
  const transcript = lines.join("\n");
  await note(`the agent's tool calls and their output:\n${transcript}`);
  return transcript;
}

export async function connectAndStart(
  window: Page,
  note: Note,
  seeded: Parameters<typeof signIn>[1],
  prompt: string,
  turnTimeoutMs: number,
): Promise<SessionIndexEntry> {
  const repositoryPath = await seedRepository();
  const origin = await seedOrigin(repositoryPath);
  await note(`repository ${repositoryPath}, origin ${origin}`);
  const worktreeRoot = await temporaryDir("rde-worktrees-");
  await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
  await openSettings(window, note);
  await window.getByRole("button", { name: "Metabase", exact: true }).click();
  await signIn(window, seeded, note);
  await window.getByText(seeded.adminApiKeyEmail).first().waitFor({ state: "visible" });
  await closeSettings(window);
  await note(`signed in to ${seeded.baseUrl}`);
  await chooseOption(window, "permission", ALL_PERMISSIONS);
  await startSession(window, prompt, WORKTREE_OPTION);
  await awaitCheckpoint(window, turnTimeoutMs);
  return newestSession(window);
}

const METABASE_LOOP: Scenario = {
  name: "metabase-loop",
  unit: UNIT,
  gate: null,
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    const session = await connectAndStart(window, note, seeded, SKILLS_PROMPT, TURN_TIMEOUT_MS);
    const worktree = session.workspace.path;
    await note(`session ${session.id} in ${worktree}`);
    const tools = await noteTools(window, session.id, note);
    for (const expected of ["rde-cli/bin/mb", ...REPO_FIRST_SKILLS]) {
      if (!tools.includes(expected)) {
        throw new DriverFailure(`the agent's mb output never names ${expected}`);
      }
    }

    await sidePanel(window).getByRole("tab", { name: "Metabase", exact: true }).click();
    const loop = sidePanel(window).getByRole("region", { name: "This branch in Metabase" });
    await loop.getByRole("button").first().waitFor({ state: "visible" });
    const opened = await panelState(window, session.id);
    await note(`the panel's state on opening: ${JSON.stringify(opened)}`);
    const first = await shoot(window, dir, UNIT, "metabase-panel");
    await note(`the Metabase panel for the session: ${first}`);

    await sidePanel(window).getByRole("button", { name: "Add to .gitignore" }).click();
    await sidePanel(window)
      .getByRole("button", { name: "Add to .gitignore" })
      .waitFor({ state: "detached" });
    const gitignore = await readFile(join(worktree, ".gitignore"), "utf8");
    await note(`the worktree's .gitignore after the ask:\n${gitignore.trimEnd()}`);
    for (const directory of IGNORED_DIRECTORIES) {
      if (!gitignore.split("\n").includes(directory)) {
        throw new DriverFailure(`.gitignore does not name ${directory}`);
      }
    }
    await loop.locator("[data-sync-blocked]").waitFor({ state: "visible" });
    await note(
      `with .gitignore uncommitted: ${await loop.locator("[data-sync-blocked]").innerText()}`,
    );

    await sidePanel(window).getByRole("tab", { name: "Changes", exact: true }).click();
    await sidePanel(window).getByRole("button", { name: "Commit", exact: true }).click();
    const commit = window.getByRole("dialog");
    await commit.getByRole("button", { name: "Commit", exact: true }).click();
    await commit.waitFor({ state: "detached" });
    await sidePanel(window).getByRole("tab", { name: "Metabase", exact: true }).click();

    const committed = await git(worktree, "log", "-1", "--name-only", "--format=%s");
    await note(`the branch's last commit, made through the Changes panel:\n${committed.trimEnd()}`);
    if (!committed.includes(".gitignore")) {
      throw new DriverFailure("the commit does not carry the .gitignore the ask wrote");
    }
    const state = await panelState(window, session.id);
    await note(`the panel's state after the commit: ${JSON.stringify(state)}`);
    const syncButton = loop.getByRole("button", { name: SYNC_LABELS });
    const blocked = await loop.locator("[data-sync-blocked]").innerText();
    await note(
      `Sync to Metabase is ${(await syncButton.isDisabled()) ? "disabled" : "enabled"}: ${blocked}`,
    );
    if (state.readiness.kind !== "blocked" || !(await syncButton.isDisabled())) {
      throw new DriverFailure("the panel offers a sync this instance cannot take");
    }
    if (state.remoteSync.kind === "unavailable") {
      await note(`the instance's own answer: ${state.remoteSync.message}`);
    }
    const synced = await shoot(window, dir, UNIT, "loop");
    await note(`after Sync to Metabase: ${synced}`);

    await sidePanel(window).getByRole("button", { name: "Refresh metadata" }).click();
    const metadataNote = sidePanel(window)
      .getByRole("region", { name: "Metadata" })
      .getByRole("alert");
    const refreshed = sidePanel(window).locator('[data-metadata="present"]');
    await metadataNote
      .or(refreshed)
      .first()
      .waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    const metadata = await sidePanel(window).getByRole("region", { name: "Metadata" }).innerText();
    await note(`the metadata section after Refresh metadata:\n${metadata}`);
    const metadataShot = await shoot(window, dir, UNIT, "metadata");
    await note(`the metadata section: ${metadataShot}`);

    await stopEverySession(window);
    await closeApp(running);
    return `${first}, ${synced}, ${metadataShot}`;
  },
};

const AGENT_LOOP: Scenario = {
  name: "agent-loop",
  unit: UNIT,
  gate: (lane) => requireServer(lane, ["remoteSync"]),
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    const session = await connectAndStart(
      window,
      note,
      seeded,
      SEGMENT_PROMPT,
      AGENT_LOOP_TIMEOUT_MS,
    );
    await note(`session ${session.id} in ${session.workspace.path}`);
    const tools = await noteTools(window, session.id, note);
    const segments = (await git(session.workspace.path, "ls-files", "--others", "--cached"))
      .split("\n")
      .filter((path) => path.includes("/segments/"));
    await note(`segment files in the worktree: ${segments.join(", ")}`);
    if (segments.length === 0) {
      throw new DriverFailure("the agent wrote no segment file");
    }
    if (!tools.includes("mb validate")) {
      throw new DriverFailure("the agent never ran mb validate");
    }
    const shot = await shoot(window, dir, UNIT, "agent-loop");
    await note(`the session at the end of the turn: ${shot}`);

    await stopEverySession(window);
    await closeApp(running);
    return shot;
  },
};

export const METABASE_SCENARIOS: readonly Scenario[] = [METABASE_LOOP, AGENT_LOOP];
