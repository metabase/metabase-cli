import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import type { Locator, Page } from "playwright";

import { z } from "zod";

import { recordGateSkip } from "../../../../tests/e2e/server-gate";

import { DriverFailure, closeApp, timestamp, type RunningApp } from "../app";
import {
  SETTINGS_BACK_LABEL,
  chooseTheme,
  THEME_ENV_VAR,
  openWindow,
  startWithEnv,
  temporaryDir,
  type Note,
  type Scenario,
} from "../scenario";

const UNIT = "u10";
const WINDOW_MANAGER = "xfwm4";
const PYTHON = "python3";
const POINTER_SCRIPT = resolve(import.meta.dirname, "..", "x-pointer.py");
const DISPLAY_ENV_VAR = "DISPLAY";
const PATH_ENV_VAR = "PATH";
const SCREEN_SIZE = "1440x900";
const NO_WINDOW_MANAGER = `${WINDOW_MANAGER} and ${PYTHON} move the real pointer and the window; install both to drive the window chrome`;
const WM_READY_TIMEOUT_MS = 10_000;
const WM_POLL_MS = 100;
// The window manager answers a drag and a double-click on its own clock.
const WINDOW_SETTLE_MS = 800;
const STRIP_HEIGHT_PX = 48;
const DRAG = { dx: 120, dy: 60 } as const;
// A window manager starts moving the window a few pixels into the drag, so it trails the pointer
// by the first step; more than half the drag in both directions is a move the strip caused.
const DRAG_SHARE = 0.5;
const SIDE_PANEL_TOGGLE = "Show or hide the side panel";

const execFileAsync = promisify(execFile);

function onPath(binary: string): boolean {
  const path = process.env[PATH_ENV_VAR];
  if (path === undefined) {
    return false;
  }
  return path.split(delimiter).some((dir) => existsSync(join(dir, binary)));
}

function requireDisplay(): string {
  const display = process.env[DISPLAY_ENV_VAR];
  if (display === undefined) {
    throw new DriverFailure(`${DISPLAY_ENV_VAR} is not set; run under xvfb-run`);
  }
  return display;
}

async function windowManagerReady(): Promise<void> {
  const deadline = Date.now() + WM_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"]);
    if (stdout.includes("window id")) {
      return;
    }
    await sleep(WM_POLL_MS);
  }
  throw new DriverFailure(`${WINDOW_MANAGER} did not take the display`);
}

async function startWindowManager(): Promise<ChildProcess> {
  const manager = spawn(WINDOW_MANAGER, ["--compositor=off"], { stdio: "ignore" });
  await windowManagerReady();
  return manager;
}

async function pointer(action: string, ...numbers: readonly number[]): Promise<void> {
  await execFileAsync(PYTHON, [POINTER_SCRIPT, action, ...numbers.map(String)]);
  await sleep(WINDOW_SETTLE_MS);
}

async function grabScreen(dir: string, slug: string): Promise<string> {
  const path = join(dir, `${timestamp()}_${UNIT}-${slug}.png`);
  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-video_size",
    SCREEN_SIZE,
    "-i",
    requireDisplay(),
    "-frames:v",
    "1",
    path,
  ]);
  return path;
}

const Rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
type Rect = z.infer<typeof Rect>;

const WindowState = z.object({ bounds: Rect, maximized: z.boolean() });
type WindowState = z.infer<typeof WindowState>;

async function windowState(running: RunningApp): Promise<WindowState> {
  return WindowState.parse(
    await running.app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      if (window === undefined) {
        throw new Error("the app has no window");
      }
      return { bounds: window.getContentBounds(), maximized: window.isMaximized() };
    }),
  );
}

async function rectOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new DriverFailure("an element the scenario measures is not on screen");
  }
  return box;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

async function screenCentre(running: RunningApp, locator: Locator): Promise<ScreenPoint> {
  const rect = await rectOf(locator);
  const { bounds } = await windowState(running);
  return {
    x: Math.round(bounds.x + rect.x + rect.width / 2),
    y: Math.round(bounds.y + rect.y + rect.height / 2),
  };
}

const Overlay = z.object({ visible: z.boolean(), area: Rect, pageWidth: z.number() });
type Overlay = z.infer<typeof Overlay>;

async function readOverlay(window: Page): Promise<Overlay> {
  return Overlay.parse(
    await window.evaluate(`(() => {
      const overlay = navigator.windowControlsOverlay;
      const area = overlay.getTitlebarAreaRect();
      return {
        visible: overlay.visible,
        area: { x: area.x, y: area.y, width: area.width, height: area.height },
        pageWidth: window.innerWidth,
      };
    })()`),
  );
}

async function stripHeights(window: Page): Promise<number[]> {
  return z
    .array(z.number())
    .parse(
      await window.evaluate(
        `[...document.querySelectorAll('[data-slot="window-strip"]')].map((strip) => strip.getBoundingClientRect().height)`,
      ),
    );
}

// The overlay's buttons fill the strip from the end of the title bar area to the window's edge.
async function clearOfOverlay(window: Page, control: Locator, what: string): Promise<string> {
  const overlay = await readOverlay(window);
  const rect = await rectOf(control);
  const overlayStart = overlay.area.x + overlay.area.width;
  const overlaps = rect.x + rect.width > overlayStart && rect.y < overlay.area.height;
  if (overlaps) {
    throw new DriverFailure(
      `${what} at ${JSON.stringify(rect)} sits under the window controls from x ${String(overlayStart)}`,
    );
  }
  return `${what} ends at x ${String(rect.x + rect.width)}, top ${String(rect.y)}; the controls start at x ${String(overlayStart)} and end at y ${String(overlay.area.height)}`;
}

async function checkOverlay(window: Page, note: Note): Promise<void> {
  const overlay = await readOverlay(window);
  await note(`window controls overlay: ${JSON.stringify(overlay)}`);
  if (!overlay.visible || overlay.area.height !== STRIP_HEIGHT_PX) {
    throw new DriverFailure(`the overlay is not a ${String(STRIP_HEIGHT_PX)} px strip`);
  }
  const heights = await stripHeights(window);
  await note(`window strip heights: ${heights.join(", ")}`);
  if (heights.length === 0 || heights.some((height) => height !== STRIP_HEIGHT_PX)) {
    throw new DriverFailure(`every window strip is ${String(STRIP_HEIGHT_PX)} px tall`);
  }
}

async function dragStrip(running: RunningApp, handle: Locator, note: Note): Promise<void> {
  const before = await windowState(running);
  const from = await screenCentre(running, handle);
  await pointer("drag", from.x, from.y, DRAG.dx, DRAG.dy);
  const after = await windowState(running);
  const moved = { x: after.bounds.x - before.bounds.x, y: after.bounds.y - before.bounds.y };
  await note(
    `dragging the strip from ${JSON.stringify(from)} by ${JSON.stringify(DRAG)} moved the window from ${JSON.stringify(before.bounds)} to ${JSON.stringify(after.bounds)}`,
  );
  if (moved.x < DRAG.dx * DRAG_SHARE || moved.y < DRAG.dy * DRAG_SHARE) {
    throw new DriverFailure(`the window moved by ${JSON.stringify(moved)} for a drag of the strip`);
  }
}

async function driveChrome(
  running: RunningApp,
  window: Page,
  dir: string,
  note: Note,
): Promise<string[]> {
  const shots: string[] = [];
  const settings = window.getByRole("button", { name: "Settings", exact: true, disabled: false });
  await settings.waitFor({ state: "visible" });
  await chooseTheme(window, "Light");
  await checkOverlay(window, note);
  await note(
    await clearOfOverlay(
      window,
      window.getByRole("button", { name: SIDE_PANEL_TOGGLE }),
      "the side panel's toggle",
    ),
  );
  shots.push(await grabScreen(dir, "chrome-light"));

  const title = window.locator('[data-slot="window-strip"] h2');
  await dragStrip(running, title, note);

  const click = await screenCentre(running, settings);
  await pointer("click", click.x, click.y);
  const back = window.getByRole("button", { name: SETTINGS_BACK_LABEL, exact: true });
  await back.waitFor({ state: "visible" });
  await note(
    `a real click at ${JSON.stringify(click)} on Settings inside the strip opened Settings`,
  );
  const close = await screenCentre(running, back);
  await pointer("click", close.x, close.y);
  await back.waitFor({ state: "hidden" });
  await note(
    `a real click on ${SETTINGS_BACK_LABEL} in the settings column's strip closed Settings`,
  );

  const zoom = await screenCentre(running, title);
  await pointer("double-click", zoom.x, zoom.y);
  const zoomed = await windowState(running);
  await note(
    `double-clicking the strip maximized the window: ${String(zoomed.maximized)}, ${JSON.stringify(zoomed.bounds)}`,
  );
  if (!zoomed.maximized) {
    throw new DriverFailure("double-clicking the strip did not maximize the window");
  }

  await chooseTheme(window, "Dark");
  await note("switched to the dark theme through Settings");
  shots.push(await grabScreen(dir, "chrome-dark"));

  await window.getByRole("button", { name: SIDE_PANEL_TOGGLE }).click();
  const rail = window.getByRole("button", { name: SIDE_PANEL_TOGGLE });
  await note(await clearOfOverlay(window, rail, "the collapsed panel's toggle"));
  shots.push(await grabScreen(dir, "chrome-dark-collapsed"));
  return shots;
}

const CHROME: Scenario = {
  name: "chrome",
  unit: UNIT,
  gate: (lane) => {
    if (onPath(WINDOW_MANAGER) && onPath(PYTHON)) {
      return null;
    }
    recordGateSkip(lane, NO_WINDOW_MANAGER);
    return NO_WINDOW_MANAGER;
  },
  act: async ({ dir, note, onWindow }) => {
    const manager = await startWindowManager();
    await note(`${WINDOW_MANAGER} manages the display, so a drag on the strip can move the window`);
    try {
      const running = await startWithEnv(await temporaryDir("rde-userdata-"), undefined, {
        [THEME_ENV_VAR]: undefined,
      });
      const window = await openWindow(running, onWindow);
      const shots = await driveChrome(running, window, dir, note);
      await closeApp(running);
      return shots.join(", ");
    } finally {
      manager.kill();
    }
  },
};

export const CHROME_SCENARIOS: readonly Scenario[] = [CHROME];
