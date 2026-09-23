import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "playwright";
import { z } from "zod";

import { DriverFailure, closeApp, timestamp } from "../app";
import {
  TURN_TIMEOUT_MS,
  WORKTREE_OPTION,
  awaitRow,
  chooseTheme,
  git,
  openWindow,
  pointAtWorktreeRoot,
  readTranscript,
  requireRow,
  seedRepository,
  start,
  startSession,
  stopEverySession,
  temporaryDir,
  type Scenario,
  type TranscriptRow,
  shoot,
} from "../scenario";

import { FIXTURE_WORKSPACE, writeFixtureSession } from "./fixture";

const UNIT = "u5";

const READ_EDIT_PROMPT =
  "Read transforms/orders.sql and transforms/customers.sql, then change the comment at the top of transforms/orders.sql to say ready, and stop.";

const FIXTURE_TURNS = 125;
const FRAME_SAMPLE = 120;
const FPS_FLOOR = 55;
const SCROLL_STEPS = 40;
const DISCLOSURE_TOGGLES = 10;
const SECOND_MS = 1000;
const SETTLE_MS = 250;

// The list nudges the offset by a fraction of a pixel as it measures a row it has just mounted;
// what the claim forbids is the viewport moving, not that measurement settling.
const VIEWPORT_TOLERANCE_PX = 2;

const REVIEW_LIGHT = "u5-review-light.png";
const REVIEW_DARK = "u5-review-dark.png";

const AWAY_FROM_END_PX = 40;

const WHEEL_NUDGES = 4;
const WHEEL_STEP_PX = 240;

const SHORT_VIEWPORT = { width: 1440, height: 420, deviceScaleFactor: 1, mobile: false };

async function seedContent(repositoryPath: string): Promise<void> {
  await mkdir(join(repositoryPath, "transforms"), { recursive: true });
  await writeFile(
    join(repositoryPath, "transforms", "orders.sql"),
    "-- draft\nselect id, status, total from orders\n",
    "utf8",
  );
  await writeFile(
    join(repositoryPath, "transforms", "customers.sql"),
    "-- customers\nselect id, name from customers\n",
    "utf8",
  );
  await git(repositoryPath, "add", ".");
  await git(
    repositoryPath,
    "-c",
    "user.email=rde@example.com",
    "-c",
    "user.name=RDE",
    "commit",
    "-m",
    "content",
  );
}

const HOLD_MS = 3400;

async function hold(window: Page, selector: string): Promise<void> {
  await window.locator(selector).first().waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  await window.waitForTimeout(HOLD_MS);
}

function kindsOf(rows: readonly TranscriptRow[]): readonly string[] {
  return rows.map((row) => row.kind);
}

const TIMELINE_LIVE: Scenario = {
  name: "timeline-live",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    await seedContent(repositoryPath);
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    await startSession(window, READ_EDIT_PROMPT, WORKTREE_OPTION);

    await awaitRow(window, "working");
    const streaming = await shoot(window, dir, UNIT, "timeline-streaming");
    await note(`the timeline while the turn runs: ${streaming}`);

    const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
    await allow.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    const asking = await shoot(window, dir, UNIT, "timeline-request");
    await note(`the request card, with the composer mirroring its actions: ${asking}`);
    await allow.click();

    const checkpoint = await awaitRow(window, "checkpoint");
    await note(`checkpoint row: ${checkpoint}`);
    const settled = await shoot(window, dir, UNIT, "timeline-settled");
    await window.screenshot({ path: join(dir, REVIEW_LIGHT) });

    // The list mounts a window over the rows, so the whole transcript is only in the page when the
    // reader is at the top of a session short enough to fit.
    await window.evaluate(TO_TOP_SCRIPT);
    const transcript = await readTranscript(window);
    await note(
      `the finished timeline:\n${transcript.map((row) => `${row.kind}: ${row.text}`).join("\n")}`,
    );
    requireRow(transcript, "user", "Read transforms/orders.sql");
    requireRow(transcript, "checkpoint", "orders.sql");
    const kinds = kindsOf(transcript);
    if (!kinds.includes("fold")) {
      throw new DriverFailure(`the settled turn did not fold: ${kinds.join(", ")}`);
    }
    if (!kinds.includes("assistant")) {
      throw new DriverFailure(`the agent's answer is not on screen: ${kinds.join(", ")}`);
    }

    await window.locator('[data-row="fold"]').first().click();
    const opened = await shoot(window, dir, UNIT, "timeline-opened");
    await note(`the same turn with its work opened: ${opened}`);

    await chooseTheme(window, "Dark");
    const dark = await shoot(window, dir, UNIT, "timeline-settled-dark");
    await window.screenshot({ path: join(dir, REVIEW_DARK) });
    await note(`the same screen in dark: ${dark}`);
    await note(`the review gate's pair: ${join(dir, REVIEW_LIGHT)}, ${join(dir, REVIEW_DARK)}`);

    await stopEverySession(window);
    await closeApp(running);
    return `${streaming}, ${asking}, ${settled}, ${opened}, ${dark}`;
  },
};

const FrameReport = z
  .object({ frames: z.number(), seconds: z.number(), fps: z.number(), reach: z.number() })
  .strict();
type FrameReport = z.infer<typeof FrameReport>;

interface PaintCost {
  readonly layoutMs: number;
  readonly recalcMs: number;
  readonly scriptMs: number;
  readonly taskMs: number;
}

interface ScrollReport extends FrameReport, PaintCost {}

const SCROLL_NODE = ".timeline-scroll";

function scrollScript(steps: number, sample: number): string {
  return `(async () => {
    const node = document.querySelector(${JSON.stringify(SCROLL_NODE)});
    if (node === null) { throw new Error("the timeline's scroll container is not in the page"); }
    const frames = [];
    let sampling = true;
    const tick = (time) => {
      frames.push(time);
      if (sampling && frames.length < ${String(sample)}) { requestAnimationFrame(tick); }
    };
    requestAnimationFrame(tick);
    const reach = node.scrollHeight - node.clientHeight;
    if (reach <= 0) { throw new Error("the transcript fits its viewport, so nothing was scrolled"); }
    const settle = () => new Promise((done) => requestAnimationFrame(done));
    for (let step = 0; step <= ${String(steps)}; step += 1) {
      node.scrollTop = Math.round((reach * step) / ${String(steps)});
      await settle();
    }
    for (let step = ${String(steps)}; step >= 0; step -= 1) {
      node.scrollTop = Math.round((reach * step) / ${String(steps)});
      await settle();
    }
    sampling = false;
    const seconds = (frames[frames.length - 1] - frames[0]) / 1000;
    return { frames: frames.length, seconds, fps: (frames.length - 1) / seconds, reach };
  })()`;
}

const Viewport = z.object({ top: z.number(), gap: z.number(), reach: z.number() }).strict();
type Viewport = z.infer<typeof Viewport>;

const ROW_TOP_SCRIPT = `(() => {
  const row = document.querySelector('[data-row="user"]');
  return row === null ? null : Math.round(row.getBoundingClientRect().top);
})()`;

const TO_TOP_SCRIPT = `(() => {
  const node = document.querySelector(${JSON.stringify(SCROLL_NODE)});
  if (node !== null) { node.scrollTop = 0; }
})()`;

const VIEWPORT_SCRIPT = `(() => {
  const node = document.querySelector(${JSON.stringify(SCROLL_NODE)});
  if (node === null) { throw new Error("the timeline's scroll container is not in the page"); }
  return {
    top: node.scrollTop,
    gap: node.scrollHeight - node.scrollTop - node.clientHeight,
    reach: node.scrollHeight - node.clientHeight,
  };
})()`;

interface MetricReading {
  readonly name: string;
  readonly value: number;
}

function metric(readings: readonly MetricReading[], name: string): number {
  const found = readings.find((reading) => reading.name === name);
  if (found === undefined) {
    throw new DriverFailure(`the renderer reported no ${name} metric`);
  }
  return found.value;
}

function spend(
  before: readonly MetricReading[],
  after: readonly MetricReading[],
  name: string,
): number {
  return (metric(after, name) - metric(before, name)) * SECOND_MS;
}

function costBetween(before: readonly MetricReading[], after: readonly MetricReading[]): PaintCost {
  return {
    layoutMs: spend(before, after, "LayoutDuration"),
    recalcMs: spend(before, after, "RecalcStyleDuration"),
    scriptMs: spend(before, after, "ScriptDuration"),
    taskMs: spend(before, after, "TaskDuration"),
  };
}

const TIMELINE_SCROLL: Scenario = {
  name: "timeline-scroll",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const fixture = await writeFixtureSession(FIXTURE_TURNS, FIXTURE_WORKSPACE);
    await note(`a session of ${String(fixture.rows)} rows written to ${fixture.userDataDir}`);
    const running = await start(fixture.userDataDir, undefined);
    const window = await openWindow(running, onWindow);

    await window.getByRole("button", { name: fixture.title }).click();
    await awaitRow(window, "checkpoint");
    const rows = await readTranscript(window);
    if (rows.length >= fixture.rows) {
      throw new DriverFailure(
        `the list mounted all ${String(rows.length)} rows instead of a window over them`,
      );
    }
    await note(
      `the list holds ${String(rows.length)} rows in the page, a window over ${String(fixture.rows)}`,
    );

    const cdp = await window.context().newCDPSession(window);
    await cdp.send("Performance.enable");
    const before = await cdp.send("Performance.getMetrics");

    const measured = FrameReport.parse(
      await window.evaluate(scrollScript(SCROLL_STEPS, FRAME_SAMPLE)),
    );

    const afterScroll = await cdp.send("Performance.getMetrics");
    const spent: ScrollReport = {
      ...measured,
      ...costBetween(before.metrics, afterScroll.metrics),
    };

    await window.locator('[data-row="fold"]').first().click();
    const body = window.locator('[data-row="tool"]').first().getByRole("button").first();
    await body.waitFor({ state: "visible" });
    const beforeToggles = await cdp.send("Performance.getMetrics");
    for (let toggle = 0; toggle < DISCLOSURE_TOGGLES; toggle += 1) {
      await body.click();
    }
    const afterToggles = await cdp.send("Performance.getMetrics");
    const toggling = costBetween(beforeToggles.metrics, afterToggles.metrics);
    await cdp.send("Performance.disable");

    const shot = await shoot(window, dir, UNIT, "scroll");
    const logPath = join(dir, `${timestamp()}_${UNIT}-scroll.log`);
    await writeFile(
      logPath,
      [
        `xvfb-run -a --server-args="-screen 0 1440x900x24" bun scripts/drive.ts timeline-scroll`,
        "",
        `rows in the page: ${String(rows.length)} of ${String(fixture.rows)}, the list mounts a window`,
        `scrolled ${String(spent.reach)} px end to end and back`,
        `frames: ${String(spent.frames)} over ${spent.seconds.toFixed(2)} s`,
        `fps: ${spent.fps.toFixed(1)} (floor ${String(FPS_FLOOR)})`,
        `scroll layout: ${spent.layoutMs.toFixed(1)} ms`,
        `scroll style recalc: ${spent.recalcMs.toFixed(1)} ms`,
        `scroll script: ${spent.scriptMs.toFixed(1)} ms`,
        `scroll task: ${spent.taskMs.toFixed(1)} ms`,
        "",
        `${String(DISCLOSURE_TOGGLES)} disclosure toggles, each re-rendering every mounted row:`,
        `toggle layout: ${toggling.layoutMs.toFixed(1)} ms`,
        `toggle style recalc: ${toggling.recalcMs.toFixed(1)} ms`,
        `toggle script: ${toggling.scriptMs.toFixed(1)} ms`,
        `toggle task: ${toggling.taskMs.toFixed(1)} ms`,
        `screenshot: ${shot}`,
        "",
      ].join("\n"),
      "utf8",
    );
    await note(`frame times and paint cost: ${logPath}`);

    if (spent.fps < FPS_FLOOR) {
      throw new DriverFailure(
        `the scroll ran at ${spent.fps.toFixed(1)} fps, under the ${String(FPS_FLOOR)} floor`,
      );
    }

    await closeApp(running);
    return `${logPath}, ${shot}`;
  },
};

const TIMELINE_ANCHOR: Scenario = {
  name: "timeline-anchor",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    await seedContent(repositoryPath);
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    const cdp = await window.context().newCDPSession(window);
    await cdp.send("Emulation.setDeviceMetricsOverride", SHORT_VIEWPORT);
    await note(
      `the window is ${String(SHORT_VIEWPORT.width)} by ${String(SHORT_VIEWPORT.height)}, so the transcript has somewhere to scroll`,
    );
    await startSession(window, READ_EDIT_PROMPT, WORKTREE_OPTION);

    const allow = window.getByRole("button", { name: "Allow", exact: true }).last();
    await allow.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });

    const read = async (): Promise<Viewport> =>
      Viewport.parse(await window.evaluate(VIEWPORT_SCRIPT));

    await window.mouse.move(700, 200);
    for (let nudge = 0; nudge < WHEEL_NUDGES; nudge += 1) {
      await window.mouse.wheel(0, -WHEEL_STEP_PX);
    }
    const parked = await read();
    if (parked.reach <= 0) {
      throw new DriverFailure("the transcript fits its window, so nothing could be scrolled away");
    }
    if (parked.gap <= AWAY_FROM_END_PX) {
      throw new DriverFailure(
        `the wheel left the reader ${String(parked.gap)} px from the end, which still counts as following`,
      );
    }
    await note(
      `the reader wheeled up to ${String(parked.top)}, ${String(parked.gap)} px above the live edge, while the turn was running`,
    );

    const pill = window.getByRole("button", { name: "Jump to latest" });
    await pill.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    await note("the jump-to-latest pill appeared once following stopped");

    const rowBefore = z.number().parse(await window.evaluate(ROW_TOP_SCRIPT));
    await allow.click();
    await awaitRow(window, "checkpoint");
    const rowAfter = z.number().parse(await window.evaluate(ROW_TOP_SCRIPT));
    const moved = await read();

    if (Math.abs(rowAfter - rowBefore) > VIEWPORT_TOLERANCE_PX) {
      throw new DriverFailure(
        `the row the reader was on moved from ${String(rowBefore)} to ${String(rowAfter)} while the turn finished`,
      );
    }
    await note(
      `the turn finished and wrote its checkpoint; the row the reader was on stayed at ${String(rowAfter)} and the viewport at ${String(moved.top)}`,
    );

    const shot = await shoot(window, dir, UNIT, "anchor");
    await pill.click();
    await new Promise((settle) => setTimeout(settle, SETTLE_MS));
    const jumped = await read();
    if (jumped.gap > AWAY_FROM_END_PX) {
      throw new DriverFailure(`the pill left the reader ${String(jumped.gap)} px from the end`);
    }
    await note(
      `the pill took the reader from ${String(moved.top)} to the end at ${String(jumped.top)}`,
    );

    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await stopEverySession(window);
    await closeApp(running);
    return shot;
  },
};

const TIMELINE_REVIEW: Scenario = {
  name: "timeline-review",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    await seedContent(repositoryPath);
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    await hold(window, "[data-prompt]");
    await startSession(window, READ_EDIT_PROMPT, WORKTREE_OPTION);

    await awaitRow(window, "working");
    await hold(window, '[data-row="activity"]');

    const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
    await allow.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    await hold(window, '[data-row="request"]');
    await allow.click();

    await awaitRow(window, "checkpoint");
    await hold(window, '[data-row="checkpoint"]');

    await window.locator('[data-row="fold"]').first().click();
    await hold(window, '[data-row="tool"]');
    await window.locator('[data-row="tool"]').first().getByRole("button").first().click();
    await hold(window, '[data-row="tool"]');

    await chooseTheme(window, "Dark");
    await hold(window, '[data-row="assistant"]');
    await chooseTheme(window, "Light");
    await hold(window, '[data-row="assistant"]');

    const shot = await shoot(window, dir, UNIT, "review-tour");
    await note(`the tour ended on ${shot}`);
    await stopEverySession(window);
    await closeApp(running);
    return shot;
  },
};

export const TIMELINE_SCENARIOS: readonly Scenario[] = [
  TIMELINE_LIVE,
  TIMELINE_SCROLL,
  TIMELINE_ANCHOR,
  TIMELINE_REVIEW,
];
