import type { Locator, Page } from "playwright";

import { z } from "zod";

import { DriverFailure, closeApp } from "../app";
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

const UNIT = "u11";
const THEMES = ["light", "dark"] as const;
type TypeTheme = (typeof THEMES)[number];

const PROMPT =
  "Create a file named transforms/orders_by_status.sql that selects status and count(*) from orders grouped by status, then stop.";

// The slop checklist's measure of undersized text: most of what a surface reads, by character,
// renders at the body size or above, and nothing renders under the floor.
const BODY_PX = 14;
const FLOOR_PX = 12;
const BODY_SHARE_MIN = 0.5;

const REGIONS = {
  sidebar: "aside:not([aria-label])",
  main: "main",
  "side panel": 'aside[aria-label="Side panel"]',
} as const;
type Region = keyof typeof REGIONS;

const SizeCount = z.object({ px: z.number(), chars: z.number() });
type SizeCount = z.infer<typeof SizeCount>;
const SizeHistogram = z.array(SizeCount);

interface Reading {
  readonly label: string;
  readonly histogram: readonly SizeCount[];
}

// Every visible, on-screen text node under the region, open shadow roots included, weighted by its
// length. Monospace is code, which the scale does not govern, so it is counted apart.
function histogramScript(selector: string): string {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    if (root === null) return [];
    const counts = new Map();
    const onScreen = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
    };
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent.trim();
          const element = child.parentElement;
          if (text.length === 0 || element === null || !element.checkVisibility() || !onScreen(element)) continue;
          const style = getComputedStyle(element);
          if (style.fontFamily.includes("Mono")) continue;
          const px = Number.parseFloat(style.fontSize);
          counts.set(px, (counts.get(px) ?? 0) + text.length);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.shadowRoot !== null) visit(child.shadowRoot);
          visit(child);
        }
      }
    };
    visit(root);
    return [...counts].map(([px, chars]) => ({ px, chars })).sort((a, b) => a.px - b.px);
  })()`;
}

function bodyShare(histogram: readonly SizeCount[]): number {
  const total = histogram.reduce((sum, entry) => sum + entry.chars, 0);
  const body = histogram
    .filter((entry) => entry.px >= BODY_PX)
    .reduce((sum, entry) => sum + entry.chars, 0);
  return total === 0 ? 1 : body / total;
}

function summary(reading: Reading): string {
  const sizes = reading.histogram.map((entry) => `${String(entry.px)}px ${String(entry.chars)}`);
  const share = Math.round(bodyShare(reading.histogram) * 100);
  return `${reading.label}: ${String(share)}% of characters at ${String(BODY_PX)}px or more (${sizes.join(", ")})`;
}

function failures(reading: Reading): string[] {
  const found: string[] = [];
  if (bodyShare(reading.histogram) < BODY_SHARE_MIN) {
    found.push(`${reading.label} reads mostly below ${String(BODY_PX)}px`);
  }
  const under = reading.histogram.filter((entry) => entry.px < FLOOR_PX);
  if (under.length > 0) {
    found.push(`${reading.label} has text under ${String(FLOOR_PX)}px`);
  }
  return found;
}

interface Surveyor {
  readonly shots: string[];
  readonly readings: Reading[];
  readonly survey: (window: Page, state: string, regions: readonly Region[]) => Promise<void>;
}

function surveyorFor(dir: string, theme: TypeTheme, note: Note): Surveyor {
  const shots: string[] = [];
  const readings: Reading[] = [];
  return {
    shots,
    readings,
    survey: async (window, state, regions) => {
      const path = await shoot(window, dir, UNIT, `type-${theme}-${state}`);
      shots.push(path);
      await note(`${theme} ${state}: ${path}`);
      for (const region of regions) {
        const raw: unknown = await window.evaluate(histogramScript(REGIONS[region]));
        const reading = {
          label: `${theme} ${state} ${region}`,
          histogram: SizeHistogram.parse(raw),
        };
        readings.push(reading);
        await note(summary(reading));
      }
    },
  };
}

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

async function workday(
  context: ScenarioContext,
  surveyor: Surveyor,
  theme: TypeTheme,
): Promise<void> {
  const note = context.note;
  const repositoryPath = await seedRepository();
  const worktreeRoot = await temporaryDir("rde-worktrees-");
  const running = await start(await temporaryDir("rde-userdata-"), theme);
  const window = await openWindow(running, context.onWindow);

  await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
  await openSettings(window, note);
  const seeded = await context.bootstrap();
  await signIn(window, seeded, note);
  await expectVisible(window, seeded.adminApiKeyEmail);
  await surveyor.survey(window, "settings-metabase", ["main"]);
  await window.getByRole("button", { name: "Repository", exact: true }).click();
  await surveyor.survey(window, "settings-repository", ["main"]);
  await closeSettings(window);

  await startSession(window, PROMPT, WORKTREE_OPTION);
  await awaitRow(window, "working");
  await surveyor.survey(window, "running", ["sidebar", "main"]);

  await window
    .getByRole("button", { name: "Allow", exact: true })
    .first()
    .waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  await surveyor.survey(window, "waiting", ["main"]);
  await allowUntilCheckpoint(window);

  await sidePanel(window).locator("[data-item-path]").first().waitFor({ state: "visible" });
  await surveyor.survey(window, "changes", ["sidebar", "main", "side panel"]);

  await sidePanel(window).getByRole("tab", { name: "Metabase", exact: true }).click();
  await sidePanel(window).getByRole("region", { name: "This branch in Metabase" }).waitFor();
  await surveyor.survey(window, "metabase-panel", ["side panel"]);

  await stopEverySession(window);
  await closeApp(running);
}

const TYPE: Scenario = {
  name: "type",
  unit: UNIT,
  gate: null,
  act: async (context) => {
    const shots: string[] = [];
    const readings: Reading[] = [];
    for (const theme of THEMES) {
      const surveyor = surveyorFor(context.dir, theme, context.note);
      await workday(context, surveyor, theme);
      shots.push(...surveyor.shots);
      readings.push(...surveyor.readings);
    }
    const found = readings.flatMap(failures);
    if (found.length > 0) {
      throw new DriverFailure(found.join("; "));
    }
    return shots.join(", ");
  },
};

export const TYPE_SCENARIOS: readonly Scenario[] = [TYPE];
