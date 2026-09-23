import { setTimeout as sleep } from "node:timers/promises";

import type { Locator, Page } from "playwright";

import { z } from "zod";

import type { PanelId } from "../../src/contracts/layout";
import { LAYOUT_MIN_WIDTH, MAIN_AREA_MIN_WIDTH, PANEL_BOUNDS } from "../../src/contracts/layout";
import { DriverFailure, closeApp, type RunningApp } from "../app";
import { startClip, type RecordedClip } from "../recorder";
import {
  WORKTREE_OPTION,
  allowUntilCheckpoint,
  closeSettings,
  expectVisible,
  openSettings,
  openWindow,
  pointAtWorktreeRoot,
  seedRepository,
  shoot,
  start,
  startSession,
  stopEverySession,
  temporaryDir,
  type Note,
  type Scenario,
  type ScenarioContext,
} from "../scenario";

import { signIn } from "./settings";

const UNIT = "u12";
const THEME = "light";
const CLIP_NAME = `${UNIT}-resize`;

const PROMPT =
  "Create a file named transforms/orders_by_status.sql that selects status and count(*) from orders grouped by status, then stop.";

const SIDEBAR_HANDLE = "Resize the sidebar";
const SIDE_PANEL_HANDLE = "Resize the side panel";

const SIDEBAR_DRAG_PX = 96;
// The side panel's handle is its leading edge, so moving it left widens the panel.
const SIDE_PANEL_DRAG_PX = -120;
const DRAG_STEPS = 24;
const DRAG_STEP_MS = 40;
const KEY_PRESSES = 3;
const KEY_STEP_PX = 16;
// Long enough for a reviewer to see each state in the clip.
const HOLD_MS = 2000;
const SETTLE_MS = 300;
export const WIDE = { width: 1440, height: 900 } as const;
export const NARROW = { width: LAYOUT_MIN_WIDTH, height: 900 } as const;

const Widths = z.object({
  viewport: z.number(),
  sidebar: z.number(),
  main: z.number(),
  sidePanel: z.number(),
  sidebarValue: z.number(),
  sidePanelValue: z.number(),
});
type Widths = z.infer<typeof Widths>;

const WIDTHS_SCRIPT = `(() => {
  const width = (selector) => document.querySelector(selector).getBoundingClientRect().width;
  const value = (label) => Number(document.querySelector('[role="separator"][aria-label="' + label + '"]').getAttribute("aria-valuenow"));
  return {
    viewport: innerWidth,
    sidebar: width("aside:not([aria-label])"),
    main: width("main"),
    sidePanel: width('aside[aria-label="Side panel"]'),
    sidebarValue: value(${JSON.stringify(SIDEBAR_HANDLE)}),
    sidePanelValue: value(${JSON.stringify(SIDE_PANEL_HANDLE)}),
  };
})()`;

const HeldWidths = z.object({ timeline: z.number(), diff: z.number() });
type HeldWidths = z.infer<typeof HeldWidths>;

const HELD_WIDTHS_SCRIPT = `(() => {
  const width = (selector) => document.querySelector(selector).getBoundingClientRect().width;
  return { timeline: width("main .settles-on-resize"), diff: width('aside[aria-label="Side panel"] .settles-on-resize') };
})()`;

const HELD_TARGET = "held";

// Every container a drag holds and every timeline row logs each change of its border box against
// the size it had when the watch began, tagged with the phase the scenario is in, so a re-measure
// during the drag cannot hide. An observer's first report on an element is not a change.
const WATCH_SCRIPT = `(() => {
  window.rdeResizeObserver?.disconnect();
  const targets = [...document.querySelectorAll(".settles-on-resize, [data-row]")];
  const last = new Map(targets.map((target) => {
    const box = target.getBoundingClientRect();
    return [target, { width: box.width, height: box.height }];
  }));
  window.rdeResizePhase = "setup";
  window.rdeResizeLog = [];
  window.rdeResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const [size] = entry.borderBoxSize;
      const previous = last.get(entry.target);
      if (previous.width === size.inlineSize && previous.height === size.blockSize) continue;
      last.set(entry.target, { width: size.inlineSize, height: size.blockSize });
      window.rdeResizeLog.push({
        phase: window.rdeResizePhase,
        target: entry.target.getAttribute("data-row") ?? ${JSON.stringify(HELD_TARGET)},
        from: previous,
        to: { width: size.inlineSize, height: size.blockSize },
      });
    }
  });
  for (const target of targets) window.rdeResizeObserver.observe(target, { box: "border-box" });
  return targets.length;
})()`;

const Size = z.object({ width: z.number(), height: z.number() });

const ResizeEntry = z.object({
  phase: z.string(),
  target: z.string(),
  from: Size,
  to: Size,
});
type ResizeEntry = z.infer<typeof ResizeEntry>;
const ResizeLog = z.array(ResizeEntry);

// A row re-measures when any of its size changes; a held container only when its width does, since
// its height follows whatever the column stacks under it.
function remeasured(entry: ResizeEntry): boolean {
  return entry.target !== HELD_TARGET || entry.from.width !== entry.to.width;
}

async function readWidths(window: Page): Promise<Widths> {
  return Widths.parse(await window.evaluate(WIDTHS_SCRIPT));
}

async function readHeld(window: Page): Promise<HeldWidths> {
  return HeldWidths.parse(await window.evaluate(HELD_WIDTHS_SCRIPT));
}

function handle(window: Page, label: string): Locator {
  return window.getByRole("separator", { name: label, exact: true });
}

function expectWidths(widths: Widths, sidebar: number, sidePanel: number, what: string): void {
  const shown =
    widths.sidebar === sidebar &&
    widths.sidebarValue === sidebar &&
    widths.sidePanel === sidePanel &&
    widths.sidePanelValue === sidePanel;
  if (!shown) {
    throw new DriverFailure(
      `${what}: expected the sidebar at ${String(sidebar)} and the side panel at ${String(sidePanel)}, read ${JSON.stringify(widths)}`,
    );
  }
}

function describeWidths(widths: Widths): string {
  return `sidebar ${String(widths.sidebar)}, main ${String(widths.main)}, side panel ${String(widths.sidePanel)} in ${String(widths.viewport)}`;
}

type WindowPanel = Exclude<PanelId, "tree">;

interface DragPlan {
  readonly label: string;
  readonly travel: number;
  readonly panel: WindowPanel;
  readonly shot: string | null;
}

async function drag(
  window: Page,
  plan: DragPlan,
  context: ScenarioContext,
  shots: string[],
): Promise<void> {
  const box = await handle(window, plan.label).boundingBox();
  if (box === null) {
    throw new DriverFailure(`the handle "${plan.label}" is not on screen`);
  }
  const before = await readWidths(window);
  const heldBefore = await readHeld(window);
  const watched = z.number().parse(await window.evaluate(WATCH_SCRIPT));
  await sleep(SETTLE_MS);
  await window.evaluate(`window.rdeResizePhase = "drag"`);

  // Whole pixels, so the pointer's travel is exactly the planned one.
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await window.mouse.move(x, y);
  await window.mouse.down();
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    await window.mouse.move(x + (plan.travel * step) / DRAG_STEPS, y);
    await sleep(DRAG_STEP_MS);
  }
  const during = await readWidths(window);
  const heldDuring = await readHeld(window);
  if (plan.shot !== null) {
    shots.push(await shoot(window, context.dir, UNIT, plan.shot));
  }
  await window.evaluate(`window.rdeResizePhase = "settled"`);
  await window.mouse.up();
  await sleep(SETTLE_MS);
  const after = await readWidths(window);
  const heldAfter = await readHeld(window);
  const log = ResizeLog.parse(await window.evaluate("window.rdeResizeLog"));

  const grows = plan.panel === "sidebar" ? plan.travel : -plan.travel;
  const target = before[plan.panel] + grows;
  const inDrag = log.filter((entry) => entry.phase === "drag");
  const remeasuredInDrag = inDrag.filter(remeasured);
  const settled = log.filter((entry) => entry.phase === "settled");
  await context.note(
    `dragged "${plan.label}" by ${String(plan.travel)} px in ${String(DRAG_STEPS)} moves: before ${describeWidths(before)}; during ${describeWidths(during)}; after ${describeWidths(after)}`,
  );
  await context.note(
    `held containers (timeline, diff): before ${JSON.stringify(heldBefore)}, at the last move ${JSON.stringify(heldDuring)}, after ${JSON.stringify(heldAfter)}; of ${String(watched)} watched elements, ${String(inDrag.length)} size changes during the drag and ${String(settled.length)} once it ended (${String(settled.filter((entry) => entry.target !== HELD_TARGET).length)} of them timeline rows)`,
  );
  if (inDrag.length > 0) {
    await context.note(`size changes during the drag: ${JSON.stringify(inDrag)}`);
  }
  if (during[plan.panel] !== target || after[plan.panel] !== target) {
    throw new DriverFailure(`the column did not follow the pointer to ${String(target)} px`);
  }
  if (heldDuring.timeline !== heldBefore.timeline || heldDuring.diff !== heldBefore.diff) {
    throw new DriverFailure("the timeline or the diff changed width while the handle moved");
  }
  if (remeasuredInDrag.length > 0) {
    throw new DriverFailure(
      `${String(remeasuredInDrag.length)} elements re-measured during the drag`,
    );
  }
  if (settled.length === 0) {
    throw new DriverFailure("nothing re-measured when the drag ended");
  }
  if (after.main < MAIN_AREA_MIN_WIDTH) {
    throw new DriverFailure(`the main area fell under ${String(MAIN_AREA_MIN_WIDTH)} px`);
  }
}

interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export async function resizeWindow(
  running: RunningApp,
  window: Page,
  size: WindowSize,
): Promise<void> {
  await running.app.evaluate(({ BrowserWindow }, next) => {
    const [first] = BrowserWindow.getAllWindows();
    if (first === undefined) {
      throw new Error("the app has no window");
    }
    first.setSize(next.width, next.height);
  }, size);
  await window.waitForFunction(`innerWidth === ${String(size.width)}`);
  await sleep(SETTLE_MS);
}

async function openShell(running: RunningApp, context: ScenarioContext): Promise<Page> {
  const window = await openWindow(running, context.onWindow);
  await handle(window, SIDE_PANEL_HANDLE).waitFor({ state: "visible" });
  return window;
}

interface Launched {
  readonly running: RunningApp;
  readonly window: Page;
}

async function relaunch(
  previous: RunningApp,
  userDataDir: string,
  context: ScenarioContext,
): Promise<Launched> {
  await closeApp(previous);
  const running = await start(userDataDir, THEME);
  return { running, window: await openShell(running, context) };
}

interface SessionShell extends Launched {
  readonly userDataDir: string;
}

async function resizeAndRelaunch(shell: SessionShell, context: ScenarioContext): Promise<string[]> {
  const { running: first, window: firstWindow, userDataDir } = shell;
  const note: Note = context.note;
  const shots: string[] = [];
  const initial = await readWidths(firstWindow);
  expectWidths(
    initial,
    PANEL_BOUNDS.sidebar.initial,
    PANEL_BOUNDS.sidePanel.initial,
    "a new profile",
  );
  await note(`opened at the initial widths: ${describeWidths(initial)}`);
  await sleep(HOLD_MS);

  const sidebarPlan: DragPlan = {
    label: SIDEBAR_HANDLE,
    travel: SIDEBAR_DRAG_PX,
    panel: "sidebar",
    shot: "resize-dragging",
  };
  await drag(firstWindow, sidebarPlan, context, shots);
  await sleep(HOLD_MS);
  const sidePanelPlan: DragPlan = {
    label: SIDE_PANEL_HANDLE,
    travel: SIDE_PANEL_DRAG_PX,
    panel: "sidePanel",
    shot: null,
  };
  await drag(firstWindow, sidePanelPlan, context, shots);
  const dragged = await readWidths(firstWindow);
  shots.push(await shoot(firstWindow, context.dir, UNIT, "resize-wide"));
  await sleep(HOLD_MS);

  await resizeWindow(first, firstWindow, NARROW);
  const narrow = await readWidths(firstWindow);
  await note(`the window at its minimum width: ${describeWidths(narrow)}`);
  expectWidths(
    narrow,
    PANEL_BOUNDS.sidebar.min,
    PANEL_BOUNDS.sidePanel.min,
    "the narrowest window",
  );
  if (narrow.main < MAIN_AREA_MIN_WIDTH) {
    throw new DriverFailure(`the main area fell under ${String(MAIN_AREA_MIN_WIDTH)} px`);
  }
  shots.push(await shoot(firstWindow, context.dir, UNIT, "resize-narrow"));
  await sleep(HOLD_MS);
  await resizeWindow(first, firstWindow, WIDE);
  const widened = await readWidths(firstWindow);
  await note(`the window wide again shows the chosen widths: ${describeWidths(widened)}`);
  expectWidths(widened, dragged.sidebar, dragged.sidePanel, "the window widened again");

  await stopEverySession(firstWindow);
  const { running: second, window: secondWindow } = await relaunch(first, userDataDir, context);
  const reread = await readWidths(secondWindow);
  await note(`after a relaunch: ${describeWidths(reread)}`);
  expectWidths(reread, dragged.sidebar, dragged.sidePanel, "the relaunch");
  await sleep(HOLD_MS);

  await handle(secondWindow, SIDE_PANEL_HANDLE).dblclick();
  await sleep(SETTLE_MS);
  const reset = await readWidths(secondWindow);
  await note(`double-clicking the side panel's handle: ${describeWidths(reset)}`);
  expectWidths(reset, dragged.sidebar, PANEL_BOUNDS.sidePanel.initial, "the double-click");
  await sleep(HOLD_MS);

  await handle(secondWindow, SIDEBAR_HANDLE).focus();
  for (let press = 0; press < KEY_PRESSES; press += 1) {
    await secondWindow.keyboard.press("ArrowLeft");
    await sleep(SETTLE_MS);
  }
  const keyed = await readWidths(secondWindow);
  const keyedSidebar = dragged.sidebar - KEY_PRESSES * KEY_STEP_PX;
  await note(
    `${String(KEY_PRESSES)} presses of ArrowLeft on the focused sidebar handle: ${describeWidths(keyed)}`,
  );
  expectWidths(keyed, keyedSidebar, PANEL_BOUNDS.sidePanel.initial, "the keyboard");
  await sleep(HOLD_MS);

  const { running: third, window: thirdWindow } = await relaunch(second, userDataDir, context);
  const kept = await readWidths(thirdWindow);
  await note(`after a second relaunch: ${describeWidths(kept)}`);
  expectWidths(kept, keyedSidebar, PANEL_BOUNDS.sidePanel.initial, "the second relaunch");
  await sleep(HOLD_MS);
  await closeApp(third);
  return shots;
}

async function withSession(context: ScenarioContext): Promise<SessionShell> {
  const note = context.note;
  const repositoryPath = await seedRepository();
  const worktreeRoot = await temporaryDir("rde-worktrees-");
  const userDataDir = await temporaryDir("rde-userdata-");
  const running = await start(userDataDir, THEME);
  const window = await openShell(running, context);

  await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
  await openSettings(window, note);
  const seeded = await context.bootstrap();
  await signIn(window, seeded, note);
  await expectVisible(window, seeded.adminApiKeyEmail);
  await closeSettings(window);

  await startSession(window, PROMPT, WORKTREE_OPTION);
  await allowUntilCheckpoint(window);
  const sidePanel = window.getByRole("complementary", { name: "Side panel" });
  await sidePanel.locator(".rde-diff").waitFor({ state: "visible" });
  await note("the turn landed its checkpoint and the side panel shows its diff");
  return { running, window, userDataDir };
}

const RESIZE: Scenario = {
  name: "resize",
  unit: UNIT,
  gate: null,
  act: async (context) => {
    const shell = await withSession(context);
    const clip = startClip(context.dir, CLIP_NAME);
    let recorded: RecordedClip;
    let shots: string[];
    try {
      shots = await resizeAndRelaunch(shell, context);
    } finally {
      recorded = await clip.stop();
    }
    await context.note(`clip: ${recorded.path} (${recorded.seconds.toFixed(1)} s)`);
    return [...shots, recorded.path].join(", ");
  },
};

export const RESIZE_SCENARIOS: readonly Scenario[] = [RESIZE];
