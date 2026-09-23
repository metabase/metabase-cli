import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Locator, Page } from "playwright";
import { z } from "zod";

import { errorMessage } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import type { E2EBootstrap } from "../../../../tests/e2e/bootstrap-data";
import { runCli } from "../../../../tests/e2e/run-cli";

import { OpenedExternally } from "../../src/contracts/changes";
import type { Workspace } from "../../src/contracts/events";
import { DriverFailure, closeApp, timestamp, type RunningApp } from "../app";
import { startClip, type RecordedClip } from "../recorder";
import {
  SETTINGS_BACK_LABEL,
  chooseRepository,
  chooseTheme,
  expectVisible,
  git,
  openSettings,
  openWindow,
  seedRepository,
  start,
  temporaryDir,
  type Note,
  type Scenario,
} from "../scenario";

import { COLLAPSE_CHORD } from "./changes";
import { writeFixtureSession, type FixtureSession } from "./fixture";
import { HELD_PROGRESS, startRemoteSyncFront, type RemoteSyncFront } from "./remote-sync-front";

const UNIT = "u19";
const CLIP_NAME = `${UNIT}-metabase`;
const BRANCH = "rde/orders-by-status";
const BASE = "main";
const TRACKED_BRANCH = "main";
const AUTHOR = ["-c", "user.email=rde@example.com", "-c", "user.name=RDE"] as const;
const SETTLE_MS = 600;
// How long the clip holds on a state a reviewer should read.
const LINGER_MS = 3000;
const RUN_TIMEOUT_MS = 120_000;
const SYNC_TIMEOUT_MS = 60_000;
const PERCENT = 100;
const SCHEME = /^https?:\/\//u;

const THEMES = ["Light", "Dark"] as const;

const SYNC_LABELS = /^(Sync to Metabase|Push and sync)$/u;
const REMOTE_SYNC_OFF = "Remote sync isn't enabled on this instance";
const TESTS_OFF = "Transform tests aren't enabled on this instance";
const NO_CONTENT = "hasn't changed any content";
const MISSING_DEFINITION = "must have required property 'definition'";

const TRANSFORM_PATH = "collections/transforms/orders_by_status.yaml";
const DASHBOARD_PATH = "collections/main/orders_overview.yaml";
const SEGMENT_PATH = "databases/warehouse/schemas/public/tables/orders/segments/big_orders.yaml";
const SEGMENT_NAME = "Big orders";
const SEGMENT_EID = "bIgOrDeRsSeGmEnT00001";

const Entity = z.object({
  id: z.number().int(),
  entity_id: z.string().length(21),
  name: z.string(),
});
type Entity = z.infer<typeof Entity>;

interface SeededContent {
  readonly transform: Entity;
  readonly dashboard: Entity;
}

interface Checks {
  readonly note: Note;
  readonly failed: string[];
}

// Every claim is checked and recorded rather than thrown at once, so a run on the old panel still
// takes every shot and lists each claim it fails.
async function check(checks: Checks, claim: string, prove: () => Promise<void>): Promise<void> {
  try {
    await prove();
    await checks.note(`ok: ${claim}`);
  } catch (error) {
    checks.failed.push(claim);
    await checks.note(`NOT: ${claim}: ${errorMessage(error)}`);
  }
}

async function readEntity(seeded: E2EBootstrap, noun: string, id: number): Promise<Entity> {
  const result = await runCli({
    args: [noun, "get", String(id), "--full", "--max-bytes", "0", "--json"],
    env: { MB_URL: seeded.baseUrl, MB_API_KEY: seeded.adminApiKey },
  });
  if (result.exitCode !== 0) {
    throw new DriverFailure(`mb ${noun} get ${String(id)} exited ${String(result.exitCode)}`);
  }
  return parseJson(result.stdout, Entity, { source: `mb ${noun} get` });
}

function transformYaml(transform: Entity): string {
  return `name: ${transform.name}
entity_id: ${transform.entity_id}
creator_id: admin@example.com
description: Orders counted by status, test rows dropped
source_database_id: warehouse
source:
  type: query
  query:
    "lib/type": mbql/query
    database: warehouse
    stages:
      - "lib/type": mbql.stage/native
        native: SELECT status, COUNT(*) AS n FROM orders WHERE status <> 'test' GROUP BY status
target:
  database: warehouse
  type: table
  schema: public
  name: ${transform.name}
serdes/meta:
- id: ${transform.entity_id}
  label: ${transform.name}
  model: Transform
`;
}

function dashboardYaml(dashboard: Entity): string {
  return `name: ${dashboard.name}
entity_id: ${dashboard.entity_id}
creator_id: admin@example.com
description: Orders by status, weekly
collection_id: null
dashcards: []
serdes/meta:
- id: ${dashboard.entity_id}
  label: orders_overview
  model: Dashboard
`;
}

// A segment with no definition, which the representation schema refuses.
const SEGMENT_YAML = `name: ${SEGMENT_NAME}
entity_id: ${SEGMENT_EID}
creator_id: admin@example.com
description: Orders over 100
table_id:
- warehouse
- public
- orders
serdes/meta:
- id: ${SEGMENT_EID}
  label: big_orders
  model: Segment
`;

async function writeContent(worktree: string, content: SeededContent): Promise<void> {
  const files: ReadonlyArray<readonly [string, string]> = [
    [TRANSFORM_PATH, transformYaml(content.transform)],
    [DASHBOARD_PATH, dashboardYaml(content.dashboard)],
    [SEGMENT_PATH, SEGMENT_YAML],
  ];
  for (const [path, text] of files) {
    await mkdir(dirname(join(worktree, path)), { recursive: true });
    await writeFile(join(worktree, path), text, "utf8");
  }
}

function checkpointRef(sessionId: string, seq: number): string {
  return `refs/rde/checkpoints/${sessionId}/${String(seq)}`;
}

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

function contentItem(window: Page, name: string): Locator {
  return sidePanel(window).locator("[data-content-item]", { hasText: name });
}

async function showMetabase(window: Page): Promise<void> {
  await sidePanel(window).getByRole("tab", { name: "Metabase", exact: true }).click();
  await sidePanel(window).locator("[data-metadata]").waitFor({ state: "visible" });
  await window.waitForTimeout(SETTLE_MS);
}

// The panel reads the checkout when it mounts; hiding and showing it is how a person makes it look
// again after files moved underneath it.
async function reread(window: Page): Promise<void> {
  await window.locator("[data-prompt]").focus();
  await window.keyboard.press(COLLAPSE_CHORD);
  await sidePanel(window).waitFor({ state: "detached" });
  await window.keyboard.press(COLLAPSE_CHORD);
  await showMetabase(window);
}

async function opened(window: Page): Promise<OpenedExternally> {
  return OpenedExternally.parse(await window.evaluate("window.rde.testOpenedExternally()"));
}

async function shootPanel(window: Page, dir: string, slug: string): Promise<string> {
  const path = join(dir, `${timestamp()}_${UNIT}-metabase-${slug}.png`);
  await sidePanel(window).screenshot({ path });
  return path;
}

interface ShotRun {
  readonly window: Page;
  readonly dir: string;
  readonly note: Note;
  readonly shots: string[];
}

async function shootThemes(run: ShotRun, state: string): Promise<void> {
  for (const theme of THEMES) {
    await chooseTheme(run.window, theme);
    await showMetabase(run.window);
    const slug = `${state}-${theme.toLowerCase()}`;
    const panel = await shootPanel(run.window, run.dir, slug);
    const whole = join(run.dir, `${timestamp()}_${UNIT}-metabase-${slug}-window.png`);
    await run.window.screenshot({ path: whole });
    run.shots.push(panel, whole);
    await run.note(`${state}, ${theme}: ${panel}, ${whole}`);
  }
}

async function signInTo(window: Page, url: string, apiKey: string, note: Note): Promise<void> {
  await openSettings(window, note);
  await window.getByLabel("Metabase URL").fill(url);
  await window.getByRole("button", { name: "Check URL" }).click();
  const field = window.getByLabel("API key");
  const useApiKey = window.getByRole("button", { name: "Use an API key instead", exact: true });
  await field.or(useApiKey).first().waitFor({ state: "visible" });
  if (await useApiKey.isVisible()) {
    await useApiKey.click();
  }
  await field.fill(apiKey);
  await window.getByRole("button", { name: "Sign in", exact: true }).click();
  await note(`signed in to ${url} with the bootstrap API key`);
}

interface Launched {
  readonly running: RunningApp;
  readonly window: Page;
}

async function launch(
  fixture: FixtureSession,
  repositoryPath: string,
  url: string,
  seeded: E2EBootstrap,
  context: { readonly note: Note; readonly onWindow: (window: Page) => void },
): Promise<Launched> {
  const running = await start(fixture.userDataDir, undefined);
  const window = await openWindow(running, context.onWindow);
  await signInTo(window, url, seeded.adminApiKey, context.note);
  await expectVisible(window, seeded.adminApiKeyEmail);
  await window
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Repository", exact: true })
    .click();
  await chooseRepository(window, repositoryPath);
  await expectVisible(window, repositoryPath);
  await window.getByRole("button", { name: SETTINGS_BACK_LABEL, exact: true }).click();
  await window.locator("[data-session-open]", { hasText: fixture.title }).click();
  await window.locator('[data-row="checkpoint"]').first().waitFor({ state: "visible" });
  await showMetabase(window);
  return { running, window };
}

async function checkHead(window: Page, checks: Checks, seeded: E2EBootstrap): Promise<void> {
  const panel = sidePanel(window);
  const host = seeded.baseUrl.replace(SCHEME, "");
  await check(checks, "the head names the instance's host", async () => {
    const text = await panel.innerText();
    if (!text.includes(host)) {
      throw new DriverFailure(`the panel reads:\n${text}`);
    }
  });
  await check(checks, "Open Metabase opens the instance through the app's opener", async () => {
    await panel.getByRole("link", { name: "Open Metabase", exact: true }).click();
    await window.waitForTimeout(SETTLE_MS);
    const urls = (await opened(window)).urls;
    if (!urls.some((url) => url.startsWith(seeded.baseUrl))) {
      throw new DriverFailure(`the opener recorded ${JSON.stringify(urls)}`);
    }
  });
  await check(checks, "no row lists what the instance offers", async () => {
    const text = await panel.innerText();
    if (text.includes("not available") || text.includes("available\n")) {
      throw new DriverFailure(`the panel still lists capabilities:\n${text}`);
    }
  });
}

async function checkEmpty(window: Page, checks: Checks): Promise<void> {
  const panel = sidePanel(window);
  await check(checks, "a missing remote sync is the reason syncing is off", async () => {
    await panel.getByText(REMOTE_SYNC_OFF).first().waitFor({ state: "visible" });
  });
  await check(checks, "a session with no changes says it has no content", async () => {
    await panel
      .getByRole("region", { name: "This session's content" })
      .getByText(NO_CONTENT)
      .waitFor({ state: "visible" });
  });
  await check(checks, "the metadata line stays", async () => {
    await panel.locator("[data-metadata]").waitFor({ state: "visible" });
  });
}

async function checkContent(
  window: Page,
  checks: Checks,
  worktree: string,
  content: SeededContent,
): Promise<void> {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["transform", content.transform.name],
    ["dashboard", content.dashboard.name],
    ["segment", SEGMENT_NAME],
  ];
  await check(
    checks,
    "each changed file is listed as a Metabase object by kind and name",
    async () => {
      for (const [kind, name] of rows) {
        const item = contentItem(window, name);
        await item.waitFor({ state: "visible" });
        const text = (await item.innerText()).toLowerCase();
        if (!text.includes(kind)) {
          throw new DriverFailure(`${name} does not say it is a ${kind}: ${text}`);
        }
      }
    },
  );
  await check(checks, "the invalid segment shows its error and opens its file", async () => {
    const item = contentItem(window, SEGMENT_NAME);
    await item.getByText(MISSING_DEFINITION).waitFor({ state: "visible" });
    await item.getByRole("button", { name: `Open ${SEGMENT_PATH}`, exact: true }).click();
    await window.waitForTimeout(SETTLE_MS);
    const paths = (await opened(window)).paths;
    if (!paths.includes(join(worktree, SEGMENT_PATH))) {
      throw new DriverFailure(`the opener recorded ${JSON.stringify(paths)}`);
    }
  });
  await check(checks, "the valid files read as valid", async () => {
    for (const name of [content.transform.name, content.dashboard.name]) {
      const state = await contentItem(window, name).getAttribute("data-validation");
      if (state !== "valid") {
        throw new DriverFailure(`${name} reads ${String(state)}`);
      }
    }
  });
  await check(checks, "an object Metabase holds opens in Metabase", async () => {
    const name = content.transform.name;
    await contentItem(window, name)
      .getByRole("link", { name: `Open ${name} in Metabase`, exact: true })
      .click();
    await window.waitForTimeout(SETTLE_MS);
    const urls = (await opened(window)).urls;
    const expected = `/data-studio/transforms/${String(content.transform.id)}`;
    if (!urls.some((url) => url.endsWith(expected))) {
      throw new DriverFailure(`the opener recorded ${JSON.stringify(urls)}`);
    }
  });
  await check(
    checks,
    "a missing transform-test feature is the reason Run tests is off",
    async () => {
      const item = contentItem(window, content.transform.name);
      const tests = item.getByRole("button", { name: "Run tests", exact: true });
      if (!(await tests.isDisabled())) {
        throw new DriverFailure("Run tests is enabled on an instance without transform tests");
      }
      await item.getByText(TESTS_OFF).waitFor({ state: "visible" });
    },
  );
  await check(checks, "Run runs the transform and the row shows its last run", async () => {
    const item = contentItem(window, content.transform.name);
    await item.getByRole("button", { name: "Run", exact: true }).click();
    await item.locator("[data-last-run]").waitFor({ state: "visible", timeout: RUN_TIMEOUT_MS });
    await checks.note(`the transform's row after Run: ${await item.innerText()}`);
  });
}

async function checkBranch(window: Page, checks: Checks, dashboardName: string): Promise<void> {
  const branch = sidePanel(window).getByRole("region", { name: "This branch in Metabase" });
  await check(checks, "the branch section names the branch Metabase is synced to", async () => {
    await branch.getByText(TRACKED_BRANCH, { exact: true }).first().waitFor({ state: "visible" });
  });
  await check(checks, "the edits made in Metabase and not in git are named", async () => {
    await branch.getByText(dashboardName).first().waitFor({ state: "visible" });
  });
  await check(checks, "remote changes Metabase has not pulled are said", async () => {
    await branch.locator("[data-remote-changes]").waitFor({ state: "visible" });
  });
}

async function checkRunningSync(window: Page, checks: Checks): Promise<void> {
  await check(checks, "a running import shows its progress", async () => {
    const bar = sidePanel(window).getByRole("progressbar");
    await bar.waitFor({ state: "visible", timeout: SYNC_TIMEOUT_MS });
    const now = await bar.getAttribute("aria-valuenow");
    if (now !== String(HELD_PROGRESS * PERCENT)) {
      throw new DriverFailure(`the bar reads ${String(now)}`);
    }
  });
}

async function checkSynced(window: Page, checks: Checks, content: SeededContent): Promise<void> {
  const panel = sidePanel(window);
  await check(checks, "the import's result is shown once it ends", async () => {
    await panel
      .locator('[data-sync-task="successful"]')
      .waitFor({ state: "visible", timeout: SYNC_TIMEOUT_MS });
  });
  await check(checks, "after the sync the dashboard opens in Metabase", async () => {
    await contentItem(window, content.dashboard.name)
      .getByRole("link", { name: `Open ${content.dashboard.name} in Metabase`, exact: true })
      .waitFor({ state: "visible" });
  });
}

async function prepareWorktree(repositoryPath: string): Promise<string> {
  const origin = await temporaryDir("rde-origin-");
  await git(origin, "init", "--quiet", "--bare", `--initial-branch=${BASE}`);
  await git(repositoryPath, "remote", "add", "origin", origin);
  await git(repositoryPath, "push", "--quiet", "--set-upstream", "origin", BASE);
  const worktree = join(await temporaryDir("rde-worktrees-"), "orders");
  await git(repositoryPath, "worktree", "add", "--quiet", "-b", BRANCH, worktree, BASE);
  return worktree;
}

// Both launches read the session against the same baseline: the branch as it was cut, before the
// content was written and committed.
async function fixtureOver(worktree: string, baseline: string): Promise<FixtureSession> {
  const workspace: Workspace = { kind: "worktree", path: worktree, branch: BRANCH, base: BASE };
  const fixture = await writeFixtureSession(1, workspace);
  await git(worktree, "update-ref", checkpointRef(fixture.sessionId, 0), baseline);
  await git(worktree, "update-ref", checkpointRef(fixture.sessionId, 1), baseline);
  return fixture;
}

const METABASE_PANEL: Scenario = {
  name: "metabase-panel",
  unit: UNIT,
  gate: null,
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const transformId = seeded.seeded.transformId;
    if (transformId === null) {
      throw new DriverFailure("the bootstrap seeded no transform, so there is none to run");
    }
    const content: SeededContent = {
      transform: await readEntity(seeded, "transform", transformId),
      dashboard: await readEntity(seeded, "dashboard", seeded.seeded.ordersDashboardId),
    };
    await note(`seeded ${JSON.stringify(content)}`);
    const repositoryPath = await seedRepository();
    const worktree = await prepareWorktree(repositoryPath);
    const baseline = (await git(worktree, "rev-parse", "HEAD")).trim();
    const checks: Checks = { note, failed: [] };
    const shots: string[] = [];

    const live = await launch(
      await fixtureOver(worktree, baseline),
      repositoryPath,
      seeded.baseUrl,
      seeded,
      {
        note,
        onWindow,
      },
    );
    await note(`session on ${BRANCH} in ${worktree}, signed in to ${seeded.baseUrl}`);
    const liveRun: ShotRun = { window: live.window, dir, note, shots };
    await checkHead(live.window, checks, seeded);
    await checkEmpty(live.window, checks);
    await shootThemes(liveRun, "empty");

    const front: RemoteSyncFront = await startRemoteSyncFront(seeded, {
      branch: TRACKED_BRANCH,
      dirty: [
        {
          id: content.dashboard.id,
          name: content.dashboard.name,
          model: "dashboard",
          sync_status: "update",
          collection_id: seeded.seeded.defaultCollectionId,
        },
      ],
      remoteChanges: true,
    });
    await note(`the remote-sync front at ${front.url} plays a licensed instance over the slot`);
    const clip = startClip(dir, CLIP_NAME);
    let recorded: RecordedClip | null = null;
    try {
      await writeContent(worktree, content);
      await reread(live.window);
      await note(`wrote ${TRANSFORM_PATH}, ${DASHBOARD_PATH} and ${SEGMENT_PATH}`);
      await live.window.waitForTimeout(LINGER_MS);
      await checkContent(live.window, checks, worktree, content);
      await live.window.waitForTimeout(LINGER_MS);
      await shootThemes(liveRun, "content");
      await closeApp(live.running);

      await git(worktree, "add", "-A");
      await git(worktree, ...AUTHOR, "commit", "--quiet", "-m", "Orders by status");
      const synced = await launch(
        await fixtureOver(worktree, baseline),
        repositoryPath,
        front.url,
        seeded,
        { note, onWindow },
      );
      const syncRun: ShotRun = { window: synced.window, dir, note, shots };
      await checkBranch(synced.window, checks, content.dashboard.name);
      await synced.window.waitForTimeout(LINGER_MS);
      await shootThemes(syncRun, "branch");

      front.hold();
      await sidePanel(synced.window).getByRole("button", { name: SYNC_LABELS }).click();
      await checkRunningSync(synced.window, checks);
      await synced.window.waitForTimeout(LINGER_MS);
      await shootThemes(syncRun, "syncing");
      front.release();
      await note(`the front finished the import of ${String(front.imported())}`);
      await checkSynced(synced.window, checks, content);
      await synced.window.waitForTimeout(LINGER_MS);
      await shootThemes(syncRun, "synced");
      await closeApp(synced.running);
    } finally {
      recorded = await clip.stop();
      await front.stop();
    }
    await note(`clip ${recorded.path}, ${String(recorded.seconds)} s`);

    if (checks.failed.length > 0) {
      throw new DriverFailure(`not shown: ${checks.failed.join("; ")}`);
    }
    return [...shots, recorded.path].join(", ");
  },
};

export const METABASE_PANEL_SCENARIOS: readonly Scenario[] = [METABASE_PANEL];
