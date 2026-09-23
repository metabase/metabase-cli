import { join } from "node:path";

import type { Locator, Page } from "playwright";

import { closeApp } from "../app";
import {
  TURN_TIMEOUT_MS,
  WORKTREE_OPTION,
  allowUntilCheckpoint,
  awaitRow,
  closeSettings,
  expectVisible,
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
  pickTheme,
} from "../scenario";

import { signIn } from "./settings";

const UNIT = "u9";
const HOLD_MS = 2800;
const PALETTE_CHORD = "Control+K";

const REVIEW_PROMPT =
  "Create transforms/orders_by_status.sql selecting status and count(*) from orders grouped by status. Then stop.";

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

// The review stills carry fixed names, so the gate's `u9-review-*.png` finds the last run's set.
async function still(window: Page, dir: string, note: Note, step: string): Promise<void> {
  const path = join(dir, `${UNIT}-review-${step}.png`);
  await window.screenshot({ path });
  await note(`${step}: ${path}`);
}

async function hold(window: Page): Promise<void> {
  await window.waitForTimeout(HOLD_MS);
}

async function runFromPalette(window: Page, query: string): Promise<void> {
  await window.keyboard.press(PALETTE_CHORD);
  const field = window.getByRole("dialog").getByRole("combobox");
  await field.waitFor({ state: "visible" });
  await field.pressSequentially(query);
  await hold(window);
  await window.keyboard.press("Enter");
}

const REVIEW: Scenario = {
  name: "review",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow, bootstrap }) => {
    const repositoryPath = await seedRepository();
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await still(window, dir, note, "onboarding");
    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    await openSettings(window, note);
    const seeded = await bootstrap();
    await signIn(window, seeded, note);
    await expectVisible(window, seeded.adminApiKeyEmail);
    await hold(window);
    await closeSettings(window);
    await still(window, dir, note, "ready");

    await startSession(window, REVIEW_PROMPT, WORKTREE_OPTION);
    await awaitRow(window, "working");
    const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
    await allow.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    await still(window, dir, note, "waiting");
    await hold(window);
    await allowUntilCheckpoint(window);
    await still(window, dir, note, "settled");
    await hold(window);

    await sidePanel(window).getByRole("button", { name: "Commit", exact: true }).click();
    const commit = window.getByRole("dialog");
    await hold(window);
    await commit.getByRole("button", { name: "Commit", exact: true }).click();
    await commit.waitFor({ state: "detached" });
    await still(window, dir, note, "committed");

    await runFromPalette(window, "metabase panel");
    await sidePanel(window).getByRole("region", { name: "This branch in Metabase" }).waitFor();
    await still(window, dir, note, "metabase");
    await hold(window);

    await runFromPalette(window, "appearance");
    await pickTheme(window, "Dark");
    await hold(window);
    await closeSettings(window);
    await still(window, dir, note, "dark");
    await hold(window);

    await stopEverySession(window);
    await closeApp(running);
    return join(dir, `${UNIT}-review.mp4`);
  },
};

export const REVIEW_SCENARIOS: readonly Scenario[] = [REVIEW];
