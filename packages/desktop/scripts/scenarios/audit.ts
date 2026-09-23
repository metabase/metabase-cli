import type { Locator, Page } from "playwright";

import { z } from "zod";

import { DriverFailure, closeApp } from "../app";
import {
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
  startWithEnv,
  stopEverySession,
  temporaryDir,
  TURN_TIMEOUT_MS,
  type Note,
  type Scenario,
  type ScenarioContext,
} from "../scenario";

import { FIXTURE_WORKSPACE, appendFailedTurn, writeFixtureSession } from "./fixture";
import { signIn } from "./settings";

const UNIT = "u9";
const THEMES = ["light", "dark"] as const;
type AuditTheme = (typeof THEMES)[number];

// A login shell and a PATH that name neither agent, which is what a machine without one looks like.
const NO_AGENT_ENV: NodeJS.ProcessEnv = { SHELL: "/bin/sh", PATH: "/usr/bin:/bin" };

const APPROVAL_PROMPT =
  "Create a file named transforms/orders_by_status.sql that selects status and count(*) from orders grouped by status, then stop.";

const FIXTURE_TURNS = 3;

interface Shooter {
  readonly shots: string[];
  readonly take: (window: Page, state: string) => Promise<void>;
}

function shooterFor(dir: string, theme: AuditTheme, note: Note): Shooter {
  const shots: string[] = [];
  return {
    shots,
    take: async (window, state) => {
      const path = await shoot(window, dir, UNIT, `audit-${theme}-${state}`);
      shots.push(path);
      await note(`${theme} ${state}: ${path}`);
    },
  };
}

function sidePanel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

// A session opens pinned to its last row; any distance left to scroll hides that row under the
// composer.
async function gapBelowLastRow(window: Page): Promise<number> {
  return z
    .number()
    .parse(
      await window.evaluate(
        `(() => { const node = document.querySelector(".timeline-scroll"); return Math.round(node.scrollHeight - node.scrollTop - node.clientHeight); })()`,
      ),
    );
}

async function firstLaunchWithoutAgents(
  context: ScenarioContext,
  theme: AuditTheme,
  shooter: Shooter,
): Promise<void> {
  const running = await startWithEnv(await temporaryDir("rde-userdata-"), theme, NO_AGENT_ENV);
  const window = await openWindow(running, context.onWindow);
  await expectVisible(window, "Finish setting up");
  await shooter.take(window, "onboarding");
  await openSettings(window, context.note);
  await window.getByRole("button", { name: "Agents", exact: true }).click();
  await expectVisible(window, "Not installed");
  await shooter.take(window, "no-agent");
  await closeApp(running);
}

async function connectedWorkday(
  context: ScenarioContext,
  theme: AuditTheme,
  shooter: Shooter,
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
  await shooter.take(window, "settings-metabase");
  await window.getByRole("button", { name: "Repository", exact: true }).click();
  await shooter.take(window, "settings-repository");
  await closeSettings(window);

  await window.locator("[data-prompt]").waitFor({ state: "visible" });
  await shooter.take(window, "empty");

  await startSession(window, APPROVAL_PROMPT, WORKTREE_OPTION);
  await awaitRow(window, "working");
  await shooter.take(window, "running");

  const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
  await allow.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  await shooter.take(window, "waiting");
  await allowUntilCheckpoint(window);
  await shooter.take(window, "settled");

  await sidePanel(window).getByRole("tab", { name: "Metabase", exact: true }).click();
  await sidePanel(window).getByRole("region", { name: "This branch in Metabase" }).waitFor();
  await shooter.take(window, "metabase-panel");

  await stopEverySession(window);
  await closeApp(running);
}

async function failedTurn(
  context: ScenarioContext,
  theme: AuditTheme,
  shooter: Shooter,
): Promise<void> {
  const fixture = await writeFixtureSession(FIXTURE_TURNS, FIXTURE_WORKSPACE);
  await appendFailedTurn(fixture);
  const running = await start(fixture.userDataDir, theme);
  const window = await openWindow(running, context.onWindow);
  await window.getByRole("button", { name: fixture.title }).click();
  await window.locator('[data-turn-outcome="failed"]').waitFor({ state: "visible" });
  const gap = await gapBelowLastRow(window);
  await context.note(`${theme} failed: ${String(gap)} px of the timeline below its last row`);
  if (gap > 0) {
    throw new DriverFailure(`a freshly opened session stops ${String(gap)} px short of its end`);
  }
  await shooter.take(window, "failed");
  await closeApp(running);
}

const AUDIT: Scenario = {
  name: "audit",
  unit: UNIT,
  gate: null,
  act: async (context) => {
    const shots: string[] = [];
    for (const theme of THEMES) {
      const shooter = shooterFor(context.dir, theme, context.note);
      await firstLaunchWithoutAgents(context, theme, shooter);
      await failedTurn(context, theme, shooter);
      await connectedWorkday(context, theme, shooter);
      shots.push(...shooter.shots);
    }
    return shots.join(", ");
  },
};

export const AUDIT_SCENARIOS: readonly Scenario[] = [AUDIT];
