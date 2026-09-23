import { join } from "node:path";

import type { Locator, Page } from "playwright";
import { z } from "zod";

import { errorMessage } from "@metabase/client/errors";

import { DriverFailure, closeApp, timestamp } from "../app";
import {
  SETTINGS_BACK_LABEL,
  chooseRepository,
  expectVisible,
  openSettings,
  openWindow,
  seedRepository,
  shoot,
  start,
  type Note,
  type Scenario,
  pickTheme,
} from "../scenario";

import { FIXTURE_WORKSPACE, addQuietSessions, writeFixtureSession } from "./fixture";
import { signIn } from "./settings";

const UNIT = "u18";
const FIXTURE_TURNS = 2;
const SETTLE_MS = 600;
const NEW_SESSION_NAME = "New session";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const NO_BORDER = "0px";

const QUIET_SESSIONS = [
  {
    id: "ses_revenue",
    title: "Revenue metric for finance",
    workspace: {
      kind: "worktree",
      path: "/tmp/rde-fixture/revenue",
      branch: "rde/revenue",
      base: "main",
    },
    pinned: true,
  },
  {
    id: "ses_churn",
    title: "Churn dashboard",
    workspace: {
      kind: "worktree",
      path: "/tmp/rde-fixture/churn",
      branch: "rde/churn",
      base: "main",
    },
    pinned: false,
  },
  {
    id: "ses_customers",
    title: "Clean up the customers table",
    workspace: { kind: "in-place", path: "/tmp/rde-fixture", branch: "main", head: null },
    pinned: false,
  },
] as const;

const THEMES = [
  { label: "Light", slug: "light" },
  { label: "Dark", slug: "dark" },
] as const;

type Theme = (typeof THEMES)[number];

const Box = z.object({
  background: z.string(),
  borderColor: z.string(),
  borderWidth: z.string(),
  width: z.number(),
  height: z.number(),
});
type Box = z.infer<typeof Box>;

// Finds the one button or field whose accessible name is `name`, from its text, its aria-label or
// its label, so the same script measures the old and the new sidebar.
function boxScript(name: string): string {
  return `(() => {
    const name = ${JSON.stringify(name)};
    const namedBy = (element) =>
      element.getAttribute("aria-label") === name ||
      element.textContent.trim() === name ||
      [...(element.labels ?? [])].some((label) => label.textContent.trim() === name);
    const element = [...document.querySelectorAll("button, input")].find(namedBy);
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      width: rect.width,
      height: rect.height,
    };
  })()`;
}

async function boxOf(window: Page, name: string): Promise<Box> {
  return Box.parse(await window.evaluate(boxScript(name)));
}

function describeBox(box: Box): string {
  return `${String(box.width)}x${String(box.height)} px, fill ${box.background}, border ${box.borderWidth} ${box.borderColor}`;
}

function hasBox(box: Box): boolean {
  const bordered = box.borderWidth !== NO_BORDER && box.borderColor !== TRANSPARENT;
  return bordered || box.background !== TRANSPARENT;
}

interface Checks {
  readonly note: Note;
  readonly failed: string[];
}

// Every claim is checked and recorded rather than thrown at once, so a run on the old sidebar still
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

function sidebarPanel(window: Page): Locator {
  return window.locator("aside", { has: window.getByRole("list", { name: "Sessions" }) });
}

function newSessionControl(window: Page): Locator {
  return window.getByRole("button", { name: NEW_SESSION_NAME, exact: true });
}

async function shootSidebar(window: Page, dir: string, slug: string): Promise<string> {
  const path = join(dir, `${timestamp()}_${UNIT}-${slug}.png`);
  await sidebarPanel(window).screenshot({ path });
  return path;
}

async function showSection(window: Page, title: string): Promise<void> {
  await window
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: title, exact: true })
    .click();
  await window.waitForTimeout(SETTLE_MS);
}

async function leaveSettings(window: Page): Promise<void> {
  await window.getByRole("button", { name: SETTINGS_BACK_LABEL, exact: true }).click();
  await sidebarPanel(window).waitFor({ state: "visible" });
  await window.waitForTimeout(SETTLE_MS);
}

// A button beside a text field must not wear the field's own fill and border, or it reads as a
// second field.
async function checkOutlineButton(window: Page, checks: Checks, theme: Theme): Promise<void> {
  await showSection(window, "Repository");
  const button = await boxOf(window, "Save worktree root");
  const field = await boxOf(window, "Worktree root");
  await checks.note(`${theme.slug}: Save worktree root ${describeBox(button)}`);
  await checks.note(`${theme.slug}: the Worktree root field ${describeBox(field)}`);
  await check(
    checks,
    `${theme.slug}: an outline button does not wear the field's box`,
    async () => {
      if (button.background === field.background && button.borderColor === field.borderColor) {
        throw new DriverFailure("the button's fill and border are the field's");
      }
    },
  );
}

async function checkNewSession(window: Page, checks: Checks, theme: Theme): Promise<void> {
  await window.locator("main").hover();
  const control = await boxOf(window, NEW_SESSION_NAME);
  const search = await boxOf(window, "Search sessions");
  await checks.note(`${theme.slug}: New session at rest ${describeBox(control)}`);
  await checks.note(`${theme.slug}: the search field ${describeBox(search)}`);
  await check(checks, `${theme.slug}: New session has no box of its own at rest`, async () => {
    if (hasBox(control)) {
      throw new DriverFailure(`it draws ${describeBox(control)}`);
    }
  });
}

async function shootTheme(
  window: Page,
  dir: string,
  checks: Checks,
  theme: Theme,
): Promise<string[]> {
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await showSection(window, "Appearance");
  await pickTheme(window, theme.label);
  await expectVisible(window, "Saved");
  await checkOutlineButton(window, checks, theme);
  const repository = await shoot(window, dir, UNIT, `repository-${theme.slug}`);
  await leaveSettings(window);

  await checkNewSession(window, checks, theme);
  const whole = await shoot(window, dir, UNIT, `sidebar-${theme.slug}`);
  const rest = await shootSidebar(window, dir, `sidebar-crop-${theme.slug}`);
  await newSessionControl(window).hover();
  await window.waitForTimeout(SETTLE_MS);
  const hover = await shootSidebar(window, dir, `sidebar-crop-hover-${theme.slug}`);
  const shots = [repository, whole, rest, hover];
  await checks.note(`${theme.slug}: ${shots.join(", ")}`);
  return shots;
}

const SIDEBAR: Scenario = {
  name: "sidebar",
  unit: UNIT,
  gate: null,
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const repositoryPath = await seedRepository();
    const fixture = await writeFixtureSession(FIXTURE_TURNS, FIXTURE_WORKSPACE);
    await addQuietSessions(fixture, QUIET_SESSIONS);
    const running = await start(fixture.userDataDir, undefined);
    const window = await openWindow(running, onWindow);
    const checks: Checks = { note, failed: [] };

    await openSettings(window, note);
    await signIn(window, seeded, note);
    await expectVisible(window, seeded.adminApiKeyEmail);
    await showSection(window, "Repository");
    await chooseRepository(window, repositoryPath);
    await expectVisible(window, repositoryPath);
    await note(`signed in to ${seeded.baseUrl}, repository ${repositoryPath}`);
    await leaveSettings(window);

    await window.locator("[data-session-open]", { hasText: fixture.title }).click();
    await window.locator('[data-row="checkpoint"]').first().waitFor({ state: "visible" });
    await note(`opened ${fixture.title}, with ${String(QUIET_SESSIONS.length)} more listed`);

    const shots: string[] = [];
    for (const theme of THEMES) {
      shots.push(...(await shootTheme(window, dir, checks, theme)));
    }

    await check(checks, "New session opens a new session's composer", async () => {
      await newSessionControl(window).click();
      await window.locator("[data-prompt]").waitFor({ state: "visible" });
      const current = await window.locator('[data-session-open][aria-current="true"]').count();
      if (current !== 0) {
        throw new DriverFailure(`${String(current)} session row is still current`);
      }
    });
    shots.push(await shoot(window, dir, UNIT, "sidebar-new-dark"));

    if (checks.failed.length > 0) {
      throw new DriverFailure(`not shown: ${checks.failed.join("; ")}`);
    }
    await closeApp(running);
    return shots.join(", ");
  },
};

export const SIDEBAR_SCENARIOS: readonly Scenario[] = [SIDEBAR];
