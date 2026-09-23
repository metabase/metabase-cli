import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "playwright";
import { z } from "zod";

import { DriverFailure, closeApp, timestamp } from "../app";
import {
  chooseOption,
  WORKTREE_OPTION,
  awaitRow,
  openWindow,
  pointAtWorktreeRoot,
  seedRepository,
  start,
  startSession,
  stopEverySession,
  temporaryDir,
  type Scenario,
} from "../scenario";

const UNIT = "u9";

const STREAM_PROMPT =
  "Write notes/orders.md: about 250 words on why orders.status should be an enum, with a SQL example. Then answer in four sentences what you wrote, and stop.";

const ALLOW_ALL = "Skip every check";
const WARM_UP_ROUNDS = 3;
const COLOUR_POLL_MS = 10;
const HIGHLIGHTED_COLOURS = 3;
const HIGHLIGHT_TIMEOUT_MS = 20_000;

// Counts what main pushes to the page: one entry per batch, with its size and arrival time.
const RECORD_BATCHES = `(() => {
  window.__rdeBatches = [];
  window.rde.onSessionEvents((batch) => {
    window.__rdeBatches.push({ at: performance.now(), events: batch.events.length });
  });
})()`;

const BatchLog = z.array(z.object({ at: z.number(), events: z.number().int().positive() }));
type BatchLog = z.infer<typeof BatchLog>;

// Shiki gives every token its own colour, so a highlighted diff line shows several.
const COLOUR_COUNT = `(() => {
  const colours = new Set();
  const visit = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot !== null) { visit(element.shadowRoot); }
      const text = element.textContent ?? "";
      if (element.children.length === 0 && text.trim().length > 0 && element.closest("[data-line]") !== null) {
        colours.add(getComputedStyle(element).color);
      }
    }
  };
  visit(document);
  return colours.size;
})()`;

interface BatchFigures {
  readonly batches: number;
  readonly events: number;
  readonly largest: number;
  readonly perBatch: number;
  readonly gapP50Ms: number;
  readonly seconds: number;
}

function percentile(sorted: readonly number[], share: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * share));
  return sorted[index] ?? 0;
}

function batchFigures(log: BatchLog): BatchFigures {
  const events = log.reduce((sum, batch) => sum + batch.events, 0);
  const gaps = log
    .slice(1)
    .map((batch, index) => batch.at - (log[index]?.at ?? batch.at))
    .toSorted((left, right) => left - right);
  const first = log[0]?.at ?? 0;
  const last = log.at(-1)?.at ?? first;
  return {
    batches: log.length,
    events,
    largest: Math.max(0, ...log.map((batch) => batch.events)),
    perBatch: log.length === 0 ? 0 : events / log.length,
    gapP50Ms: percentile(gaps, 0.5),
    seconds: (last - first) / 1000,
  };
}

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

async function colours(window: Page): Promise<number> {
  return z.number().parse(await window.evaluate(COLOUR_COUNT));
}

// The diff's worker pool ends with the last viewer, so every return to the Changes tab pays for a
// pool; the time from the click to highlighted tokens is that warm-up plus the highlight itself.
async function diffWarmUp(window: Page): Promise<number> {
  await sidePanel(window).getByRole("tab", { name: "Metabase", exact: true }).click();
  await sidePanel(window).getByRole("tab", { name: "Changes", exact: true }).click();
  const started = Date.now();
  while ((await colours(window)) < HIGHLIGHTED_COLOURS) {
    if (Date.now() - started > HIGHLIGHT_TIMEOUT_MS) {
      throw new DriverFailure("the diff was not highlighted within the timeout");
    }
    await window.waitForTimeout(COLOUR_POLL_MS);
  }
  return Date.now() - started;
}

const PERF: Scenario = {
  name: "perf",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);
    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);

    await window.evaluate(RECORD_BATCHES);
    await chooseOption(window, "permission", ALLOW_ALL);
    await startSession(window, STREAM_PROMPT, WORKTREE_OPTION);
    await awaitRow(window, "checkpoint");
    const figures = batchFigures(BatchLog.parse(await window.evaluate("window.__rdeBatches")));
    await note(`${String(figures.events)} events in ${String(figures.batches)} pushes`);

    const warmUps: number[] = [];
    for (let round = 0; round < WARM_UP_ROUNDS; round += 1) {
      warmUps.push(await diffWarmUp(window));
    }
    await note(`diff warm-up rounds: ${warmUps.join(", ")} ms`);

    const logPath = join(dir, `${timestamp()}_${UNIT}-perf-figures.log`);
    await writeFile(
      logPath,
      [
        `xvfb-run -a --server-args="-screen 0 1440x900x24" bun scripts/drive.ts perf`,
        "",
        "IPC: main coalesces session events on a 16 ms timer into one push per window",
        `events pushed during one live turn: ${String(figures.events)}`,
        `pushes: ${String(figures.batches)} over ${figures.seconds.toFixed(1)} s`,
        `events per push: ${figures.perBatch.toFixed(2)} mean, ${String(figures.largest)} largest`,
        `median gap between pushes: ${figures.gapP50Ms.toFixed(1)} ms`,
        "",
        "Diff viewer: Changes tab opened from the Metabase tab, click to highlighted tokens",
        ...warmUps.map((ms, round) => `round ${String(round + 1)}: ${String(ms)} ms`),
        "",
        "Timeline scroll and disclosure cost: the timeline-scroll scenario's log in the same run",
        "",
      ].join("\n"),
      "utf8",
    );
    await note(`figures: ${logPath}`);

    await stopEverySession(window);
    await closeApp(running);
    return logPath;
  },
};

export const PERF_SCENARIOS: readonly Scenario[] = [PERF];
