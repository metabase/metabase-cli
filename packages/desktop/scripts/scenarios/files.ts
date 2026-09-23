import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Locator, Page } from "playwright";
import { z } from "zod";

import { errorMessage } from "@metabase/client/errors";

import { OpenedExternally } from "../../src/contracts/changes";
import type { Workspace } from "../../src/contracts/events";
import { checkpointRef } from "../../src/main/git/checkpoints";
import { DriverFailure, closeApp, timestamp } from "../app";
import { startClip, type RecordedClip } from "../recorder";
import {
  chooseTheme,
  git,
  openWindow,
  seedRepository,
  start,
  temporaryDir,
  type Note,
  type Scenario,
} from "../scenario";

import { writeFixtureSession } from "./fixture";

const UNIT = "u20";
const CLIP_NAME = `${UNIT}-files`;
const BRANCH = "rde/orders-by-status";
const BASE = "main";
const AUTHOR = ["-c", "user.email=rde@example.com", "-c", "user.name=RDE"] as const;
const SETTLE_MS = 600;
// How long the clip holds on a state a reviewer should read.
const LINGER_MS = 3500;
// A highlighted file draws its tokens in more colours than the text and its line numbers.
const HIGHLIGHT_COLOURS = 3;

const TRANSFORM_PATH = "collections/transforms/orders_by_status.yaml";
const DASHBOARD_PATH = "collections/main/orders_overview.yaml";
const CARD_PATH = "collections/main/orders_by_status_card.yaml";
const SCRIPT_PATH = "scripts/check-orders.ts";

const TRANSFORM_YAML = `name: Orders by status
description: Order counts per status, refreshed nightly.
entity_id: oRdErSbYsTaTuStRaNs01
source:
  type: query
  query:
    database: Warehouse
    type: native
    native:
      query: |
        select status, count(*) as orders
        from orders
        group by status
target:
  type: table
  schema: analytics
  name: orders_by_status
`;

const CHANGED_TRANSFORM_YAML = TRANSFORM_YAML.replace(
  "Order counts per status, refreshed nightly.",
  "Order counts per status, test orders left out.",
).replace("from orders\n", "from orders\n        where status <> 'test'\n");

const DASHBOARD_YAML = `name: Orders overview
entity_id: oRdErSoVeRvIeWdAsH01
collection_id: main
dashcards: []
`;

const CARD_YAML = `name: Orders by status
entity_id: oRdErSbYsTaTuScArD01
type: question
display: bar
dataset_query:
  database: Warehouse
  type: query
  query:
    source-table: analytics.orders_by_status
`;

const SCRIPT_TS = `import { readFile } from "node:fs/promises";

interface StatusCount {
  readonly status: string;
  readonly orders: number;
}

const TEST_STATUS = "test";

export async function checkOrders(path: string): Promise<readonly StatusCount[]> {
  const rows: StatusCount[] = JSON.parse(await readFile(path, "utf8"));
  if (rows.some((row) => row.status === TEST_STATUS)) {
    throw new Error(\`\${path} still counts test orders\`);
  }
  return rows;
}
`;

const README = "# Warehouse content\n\nMetabase content for the warehouse, as YAML.\n";

const ADDED_LINE = "export const CHECKED_STATUSES = [TEST_STATUS] as const;";

const THEMES = [
  { slug: "light", label: "Light" },
  { slug: "dark", label: "Dark" },
] as const;

type Theme = (typeof THEMES)[number];

interface Checks {
  readonly note: Note;
  readonly failed: string[];
}

interface FilesRun {
  readonly window: Page;
  readonly dir: string;
  readonly worktree: string;
  readonly checks: Checks;
  readonly shots: string[];
}

// Every claim is checked and recorded rather than thrown at once, so a run on an app without the
// tab still takes every shot and lists each claim it fails.
async function check(checks: Checks, claim: string, prove: () => Promise<void>): Promise<void> {
  try {
    await prove();
    await checks.note(`ok: ${claim}`);
  } catch (error) {
    checks.failed.push(claim);
    await checks.note(`NOT: ${claim}: ${errorMessage(error)}`);
  }
}

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

function preview(window: Page, path: string): Locator {
  return sidePanel(window).getByRole("region", { name: `Preview of ${path}`, exact: true });
}

function treeRow(window: Page, name: string): Locator {
  return sidePanel(window).getByRole("treeitem", { name, exact: true });
}

async function writeText(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text, "utf8");
}

async function opened(window: Page): Promise<OpenedExternally> {
  return OpenedExternally.parse(await window.evaluate("window.rde.testOpenedExternally()"));
}

const Colours = z.array(z.string());

// The preview renders in shadow roots, so the walk descends into each one it meets.
function colourScript(path: string): string {
  return `(() => {
    const host = document.querySelector(${JSON.stringify(`[aria-label="Preview of ${path}"]`)});
    const colours = new Set();
    const walk = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) walk(element.shadowRoot);
        if (element.tagName === "SPAN" && element.childElementCount === 0 && element.textContent.trim().length > 0) {
          colours.add(getComputedStyle(element).color);
        }
      }
    };
    if (host) walk(host);
    return [...colours];
  })()`;
}

async function tokenColours(window: Page, path: string): Promise<readonly string[]> {
  return Colours.parse(await window.evaluate(colourScript(path)));
}

async function shootPanel(run: FilesRun, slug: string): Promise<void> {
  const path = join(run.dir, `${timestamp()}_${UNIT}-files-${slug}.png`);
  await sidePanel(run.window).screenshot({ path });
  run.shots.push(path);
  await run.checks.note(`${slug}: ${path}`);
}

async function shootWindow(run: FilesRun, slug: string): Promise<void> {
  const path = join(run.dir, `${timestamp()}_${UNIT}-files-${slug}.png`);
  await run.window.screenshot({ path });
  run.shots.push(path);
  await run.checks.note(`${slug}: ${path}`);
}

async function showFiles(window: Page): Promise<void> {
  await sidePanel(window).getByRole("tab", { name: "Files", exact: true }).click();
  await sidePanel(window).getByRole("tree").waitFor({ state: "visible" });
  await window.waitForTimeout(SETTLE_MS);
}

async function select(window: Page, path: string): Promise<void> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  await treeRow(window, name).click();
  await preview(window, path).waitFor({ state: "visible" });
  await window.waitForTimeout(SETTLE_MS);
}

async function checkTree(run: FilesRun, theme: Theme): Promise<void> {
  await check(run.checks, `${theme.slug}: the side panel has a Files tab`, async () => {
    await showFiles(run.window);
  });
  await check(
    run.checks,
    `${theme.slug}: the tree lists the checkout, the file the session added included`,
    async () => {
      for (const path of [TRANSFORM_PATH, DASHBOARD_PATH, CARD_PATH, SCRIPT_PATH]) {
        const name = path.slice(path.lastIndexOf("/") + 1);
        await treeRow(run.window, name).waitFor({ state: "visible" });
      }
    },
  );
  await run.window.waitForTimeout(LINGER_MS);
  await shootPanel(run, `tree-${theme.slug}`);
}

async function checkPreview(
  run: FilesRun,
  theme: Theme,
  path: string,
  slug: string,
): Promise<void> {
  await check(run.checks, `${theme.slug}: ${path} opens in a highlighted preview`, async () => {
    await select(run.window, path);
    const colours = await tokenColours(run.window, path);
    await run.checks.note(`${theme.slug}: ${path} draws ${String(colours.length)} colours`);
    if (colours.length < HIGHLIGHT_COLOURS) {
      throw new DriverFailure(`the preview draws ${String(colours.length)} colours`);
    }
  });
  await check(run.checks, `${theme.slug}: the preview of ${path} cannot be edited`, async () => {
    const shown = preview(run.window, path);
    if ((await shown.count()) !== 1) {
      throw new DriverFailure("there is no preview to edit");
    }
    const count = await shown.locator('textarea, [contenteditable="true"]').count();
    if (count !== 0) {
      throw new DriverFailure(`it holds ${String(count)} editable elements`);
    }
  });
  await run.window.waitForTimeout(LINGER_MS);
  await shootPanel(run, `${slug}-${theme.slug}`);
}

async function checkEditor(run: FilesRun): Promise<void> {
  await check(run.checks, `Open in editor hands ${SCRIPT_PATH} to the opener`, async () => {
    await sidePanel(run.window)
      .getByRole("button", { name: `Open ${SCRIPT_PATH}`, exact: true })
      .click();
    const expected = join(run.worktree, SCRIPT_PATH);
    const paths = (await opened(run.window)).paths;
    await run.checks.note(`the opener recorded ${JSON.stringify(paths)}`);
    if (!paths.includes(expected)) {
      throw new DriverFailure(`it recorded ${JSON.stringify(paths)}, not ${expected}`);
    }
  });
}

// The agent edits a file the person is reading; Refresh reads it again and the preview redraws.
async function checkReread(run: FilesRun): Promise<void> {
  await check(run.checks, `a second read of ${SCRIPT_PATH} redraws its preview`, async () => {
    await writeText(run.worktree, SCRIPT_PATH, `${SCRIPT_TS}\n${ADDED_LINE}\n`);
    await sidePanel(run.window).getByRole("button", { name: "Refresh files", exact: true }).click();
    await preview(run.window, SCRIPT_PATH).getByText(ADDED_LINE).waitFor({ state: "visible" });
  });
  await run.window.waitForTimeout(LINGER_MS);
}

async function checkMention(run: FilesRun): Promise<void> {
  const prompt = run.window.locator("[data-prompt]");
  const claim = `Mention puts @${SCRIPT_PATH} in the composer and gives it the focus`;
  await check(run.checks, claim, async () => {
    await prompt.fill("Explain what this checks:");
    await sidePanel(run.window)
      .getByRole("button", { name: `Mention ${SCRIPT_PATH}`, exact: true })
      .click();
    const expected = `Explain what this checks: @${SCRIPT_PATH} `;
    const value = await prompt.inputValue();
    if (value !== expected) {
      throw new DriverFailure(`the composer reads ${JSON.stringify(value)}`);
    }
    const focused = await run.window.evaluate(
      "document.activeElement?.hasAttribute('data-prompt') === true",
    );
    if (focused !== true) {
      throw new DriverFailure("the text landed, but the focus is elsewhere");
    }
  });
  await run.window.keyboard.type("and whether it runs in CI.");
  await run.window.waitForTimeout(LINGER_MS);
  await shootWindow(run, "mention-light");
}

async function prepareWorktree(): Promise<string> {
  const repositoryPath = await seedRepository();
  await writeText(repositoryPath, TRANSFORM_PATH, TRANSFORM_YAML);
  await writeText(repositoryPath, DASHBOARD_PATH, DASHBOARD_YAML);
  await writeText(repositoryPath, SCRIPT_PATH, SCRIPT_TS);
  await writeText(repositoryPath, "README.md", README);
  await git(repositoryPath, "add", "-A");
  await git(repositoryPath, ...AUTHOR, "commit", "--quiet", "-m", "content");
  const worktree = join(await temporaryDir("rde-worktrees-"), "orders");
  await git(repositoryPath, "worktree", "add", "--quiet", "-b", BRANCH, worktree, BASE);
  return worktree;
}

const FILES: Scenario = {
  name: "files",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const worktree = await prepareWorktree();
    const workspace: Workspace = { kind: "worktree", path: worktree, branch: BRANCH, base: BASE };
    const fixture = await writeFixtureSession(1, workspace);
    await git(worktree, "update-ref", checkpointRef(fixture.sessionId, 0), "HEAD");
    await git(worktree, "update-ref", checkpointRef(fixture.sessionId, 1), "HEAD");
    await writeText(worktree, TRANSFORM_PATH, CHANGED_TRANSFORM_YAML);
    await writeText(worktree, CARD_PATH, CARD_YAML);
    await note(`session ${fixture.sessionId} on ${BRANCH} in ${worktree}`);

    const running = await start(fixture.userDataDir, undefined);
    const window = await openWindow(running, onWindow);
    const run: FilesRun = { window, dir, worktree, checks: { note, failed: [] }, shots: [] };
    const clip = startClip(dir, CLIP_NAME);
    let recorded: RecordedClip;
    try {
      await window.getByRole("button", { name: fixture.title }).click();
      await window.locator("[data-prompt]").waitFor({ state: "visible" });
      for (const theme of THEMES) {
        await chooseTheme(window, theme.label);
        await checkTree(run, theme);
        await checkPreview(run, theme, TRANSFORM_PATH, "yaml");
        await checkPreview(run, theme, SCRIPT_PATH, "typescript");
      }
      await chooseTheme(window, THEMES[0].label);
      await check(run.checks, "the tab comes back after Settings", async () => {
        await showFiles(window);
        await select(window, SCRIPT_PATH);
      });
      await checkEditor(run);
      await run.window.waitForTimeout(LINGER_MS);
      await checkReread(run);
      await checkMention(run);
    } finally {
      recorded = await clip.stop();
    }
    await note(`clip ${recorded.path}, ${recorded.seconds.toFixed(1)} s`);
    await closeApp(running);

    if (run.checks.failed.length > 0) {
      throw new DriverFailure(`not shown: ${run.checks.failed.join("; ")}`);
    }
    return [...run.shots, recorded.path].join(", ");
  },
};

export const FILES_SCENARIOS: readonly Scenario[] = [FILES];
