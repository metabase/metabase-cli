import { join } from "node:path";

import type { Locator, Page } from "playwright";

import { z } from "zod";

import { DriverFailure, closeApp, timestamp, type RunningApp } from "../app";
import { startClip, type RecordedClip } from "../recorder";
import {
  IN_PLACE_OPTION,
  TURN_TIMEOUT_MS,
  WORKTREE_OPTION,
  allowUntilCheckpoint,
  awaitRow,
  chooseOption,
  chooseTheme,
  openWindow,
  pointAtWorktreeRoot,
  seedRepository,
  start,
  stopEverySession,
  temporaryDir,
  type Note,
  type Scenario,
} from "../scenario";

import { NARROW, WIDE, resizeWindow } from "./resize";

const UNIT = "u14";
const CLIP_NAME = `${UNIT}-composer`;

const DRAFT = "Clean the orders transform and add a test for it";
const APPROVAL_PROMPT =
  "Create a file named transforms/orders_by_status.sql that selects status and count(*) from orders grouped by status, then stop.";
const LONG_PROMPT =
  "Without using any tool, write about 400 words on how to find test rows in an orders table, then stop.";

const SETTLE_MS = 300;
// Long enough for a reviewer to see each state in the clip.
const HOLD_MS = 900;
const MAX_TAB_STOPS = 12;

const THEMES = [
  { slug: "light", label: "Light" },
  { slug: "dark", label: "Dark" },
] as const;

// The first running turn is sent with Enter, the second with the send-and-keep-drafting chord.
const RUNNING_TURNS = [
  { theme: THEMES[0], key: "Enter" },
  { theme: THEMES[1], key: "Control+Enter" },
] as const;

const WIDTHS = [
  { slug: "default", size: WIDE },
  { slug: "narrow", size: NARROW },
] as const;

// The bar's own size, how many controls it shows beside the text field, how many rows they take and
// how many reach past its edges, read the same way from any renderer.
const COMPOSER_METRICS_SCRIPT = `(() => {
  const bar = document.querySelector("[data-prompt-bar]");
  const field = bar.querySelector("[data-prompt]");
  const rects = [...bar.querySelectorAll("button, select, input, [role=tab]")]
    .filter((node) => node !== field && node.getClientRects().length > 0)
    .map((node) => node.getBoundingClientRect())
    .sort((a, b) => a.top - b.top);
  let rows = 0;
  let bottom = -Infinity;
  for (const rect of rects) {
    if (rect.top >= bottom - 1) {
      rows += 1;
      bottom = rect.bottom;
    } else {
      bottom = Math.max(bottom, rect.bottom);
    }
  }
  const box = bar.getBoundingClientRect();
  const outside = rects.filter((rect) => rect.left < box.left || rect.right > box.right).length;
  return { width: Math.round(box.width), height: Math.round(box.height), controls: rects.length, rows, outside };
})()`;

const ComposerMetrics = z
  .object({
    width: z.number(),
    height: z.number(),
    controls: z.number(),
    rows: z.number(),
    outside: z.number(),
  })
  .strict();

interface StatesRun {
  readonly running: RunningApp;
  readonly window: Page;
  readonly dir: string;
  readonly note: Note;
  readonly shots: string[];
}

async function shootWidths(run: StatesRun, state: string, theme: string): Promise<void> {
  for (const width of WIDTHS) {
    await resizeWindow(run.running, run.window, width.size);
    const metrics = ComposerMetrics.parse(await run.window.evaluate(COMPOSER_METRICS_SCRIPT));
    const path = join(
      run.dir,
      `${timestamp()}_${UNIT}-composer-${state}-${width.slug}-${theme}.png`,
    );
    await run.window.screenshot({ path });
    run.shots.push(path);
    await run.window.waitForTimeout(HOLD_MS);
    await run.note(
      `${state}, ${width.slug}, ${theme}: bar ${String(metrics.width)}x${String(metrics.height)} px, ${String(metrics.controls)} controls in ${String(metrics.rows)} rows, ${String(metrics.outside)} past its edges; ${path}`,
    );
    if (metrics.rows > 1 || metrics.outside > 0) {
      throw new DriverFailure(
        `${state} at the ${width.slug} width lays its controls on ${String(metrics.rows)} rows with ${String(metrics.outside)} past the edge`,
      );
    }
  }
  await resizeWindow(run.running, run.window, WIDE);
}

async function shootSettled(run: StatesRun, state: string): Promise<void> {
  for (const theme of THEMES) {
    await chooseTheme(run.window, theme.label);
    await shootWidths(run, state, theme.slug);
  }
}

// A running turn and an open request are shot while they last, so each theme gets its own turn.
async function shootRunning(run: StatesRun): Promise<void> {
  for (const { theme, key } of RUNNING_TURNS) {
    await chooseTheme(run.window, theme.label);
    await prompt(run.window).fill(LONG_PROMPT);
    await prompt(run.window).press(key);
    await run.note(`running, ${theme.slug}: sent with ${key}`);
    await awaitRow(run.window, "working");
    await shootWidths(run, "running", theme.slug);
    await run.window.getByRole("button", { name: "Stop", exact: true }).click();
    await run.window.locator('[data-row="working"]').waitFor({ state: "detached" });
  }
}

async function shootRequest(run: StatesRun): Promise<void> {
  const ask = run.window.getByRole("button", { name: "Allow", exact: true }).first();
  await ask.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  for (const theme of THEMES) {
    await chooseTheme(run.window, theme.label);
    await shootWidths(run, "request", theme.slug);
  }
  await allowUntilCheckpoint(run.window);
}

function prompt(window: Page): Locator {
  return window.locator("[data-prompt]");
}

// Every chip is shot with its menu open, then closed with Escape.
async function shootMenus(run: StatesRun, state: string): Promise<void> {
  const chips = run.window.locator("[data-prompt-bar] [data-chip]");
  const count = await chips.count();
  for (let index = 0; index < count; index += 1) {
    const chip = chips.nth(index);
    const id = await chip.getAttribute("data-chip");
    if (id === null) {
      throw new DriverFailure("a composer chip names no choice");
    }
    await chip.click();
    const menu = run.window.getByRole("menu");
    await menu.waitFor({ state: "visible" });
    await run.window.waitForTimeout(SETTLE_MS);
    const slug = `${state}-menu-${id.replaceAll(" ", "-")}`;
    const path = join(run.dir, `${timestamp()}_${UNIT}-composer-${slug}.png`);
    await run.window.screenshot({ path });
    run.shots.push(path);
    await run.window.waitForTimeout(HOLD_MS);
    await run.note(`${slug}: ${(await menu.innerText()).replaceAll("\n", " | ")}; ${path}`);
    await run.window.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
  }
}

async function focusedName(window: Page): Promise<string | null> {
  return z
    .string()
    .nullable()
    .parse(
      await window.evaluate(`(() => {
        const node = document.activeElement;
        if (node === null || node.closest("[data-prompt-bar]") === null) return null;
        return node.getAttribute("aria-label") ?? node.textContent.trim();
      })()`),
    );
}

async function chipText(window: Page, choice: string): Promise<string> {
  return window.locator(`[data-prompt-bar] [data-chip~="${choice}"]`).innerText();
}

// The keys the guide names, and every control one Tab after another.
async function checkKeyboard(run: StatesRun): Promise<void> {
  const window = run.window;
  const field = prompt(window);
  await field.fill("");
  await field.focus();
  await window.keyboard.type("first line");
  await window.keyboard.press("Shift+Enter");
  await window.keyboard.type("second line");
  const typed = await field.inputValue();
  if (typed !== "first line\nsecond line") {
    throw new DriverFailure(`Shift+Enter left the draft as ${JSON.stringify(typed)}`);
  }
  await window.keyboard.press("Escape");
  if ((await focusedName(window)) !== null) {
    throw new DriverFailure("Escape left the focus in the composer");
  }
  await run.note("Shift+Enter broke the line and Escape left the composer");

  await field.focus();
  const stops: string[] = [];
  for (let press = 0; press < MAX_TAB_STOPS; press += 1) {
    await window.keyboard.press("Tab");
    const name = await focusedName(window);
    if (name === null) {
      break;
    }
    stops.push(name);
  }
  await run.note(`Tab from the text field reaches: ${stops.join(" | ")}`);
  const chips = await window.locator("[data-prompt-bar] [data-chip]").count();
  if (stops.length !== chips + 1 || stops.at(-1) !== "Send") {
    throw new DriverFailure(
      `Tab reached ${String(stops.length)} controls, not ${String(chips)} chips and Send`,
    );
  }

  const workspace = window.locator('[data-prompt-bar] [data-chip~="workspace"]');
  await workspace.focus();
  await window.keyboard.press("Enter");
  const highlighted = window.locator("[role=menuitemradio][data-highlighted]");
  await highlighted.waitFor({ state: "visible" });
  // The menu takes the keys once it holds the focus, a frame or so after it shows.
  await window.locator("[role=menu]:focus, [role=menu] :focus").waitFor({ state: "attached" });
  await window.keyboard.press("ArrowDown");
  await highlighted.filter({ hasText: IN_PLACE_OPTION }).waitFor({ state: "visible" });
  await window.keyboard.press("Enter");
  await window.getByRole("menu").waitFor({ state: "detached" });
  const chosen = await chipText(window, "workspace");
  await run.note(`Enter, ArrowDown, Enter on the workspace chip: ${chosen}`);
  if (chosen !== IN_PLACE_OPTION) {
    throw new DriverFailure(`the keyboard chose ${chosen}, not ${IN_PLACE_OPTION}`);
  }
  await chooseOption(window, "workspace", WORKTREE_OPTION);
  await field.fill(DRAFT);
}

const COMPOSER_STATES: Scenario = {
  name: "composer-states",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);
    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);

    const clip = startClip(dir, CLIP_NAME);
    let recorded: RecordedClip;
    let shots: readonly string[];
    try {
      const run: StatesRun = { running, window, dir, note, shots: [] };
      await prompt(window).fill(DRAFT);
      await shootSettled(run, "new");
      await shootMenus(run, "new");
      await checkKeyboard(run);

      await prompt(window).fill(APPROVAL_PROMPT);
      await chooseOption(window, "workspace", WORKTREE_OPTION);
      await prompt(window).press("Enter");
      await run.note("new: sent with Enter");
      await shootRequest(run);
      await shootSettled(run, "idle");
      await shootRunning(run);
      shots = run.shots;
    } finally {
      recorded = await clip.stop();
    }
    await note(`clip ${recorded.path}, ${recorded.seconds.toFixed(1)} s`);
    await stopEverySession(window);
    await closeApp(running);
    return [...shots, recorded.path].join(", ");
  },
};

export const COMPOSER_SCENARIOS: readonly Scenario[] = [COMPOSER_STATES];
