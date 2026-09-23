import type { Locator, Page } from "playwright";

import { errorMessage } from "@metabase/client/errors";

import { DriverFailure, closeApp } from "../app";
import { startClip } from "../recorder";
import {
  SETTINGS_BACK_LABEL,
  chooseRepository,
  expectVisible,
  openWindow,
  seedRepository,
  shoot,
  start,
  temporaryDir,
  type Note,
  type Scenario,
  pickTheme,
} from "../scenario";

import { signIn } from "./settings";

const UNIT = "u17";
const CLIP_NAME = `${UNIT}-settings`;
const SETTLE_MS = 600;
// Each screen stays up long enough for a reviewer watching the clip to read it.
const HOLD_MS = 1500;
const PALETTE_CHORD = "Control+K";
const PALETTE_NAME = "Search sessions and actions";
const NEW_SESSION_CHORD = "Control+N";
const SIDE_PANEL_NAME = "Side panel";

const SECTIONS = [
  { title: "Metabase", slug: "metabase" },
  { title: "Repository", slug: "repository" },
  { title: "Agents", slug: "agents" },
  { title: "Appearance", slug: "appearance" },
] as const;

type SectionTitle = (typeof SECTIONS)[number]["title"];

const THEMES = [
  { label: "Light", slug: "light" },
  { label: "Dark", slug: "dark" },
] as const;

interface Checks {
  readonly note: Note;
  readonly failed: string[];
}

// Every claim is checked and recorded rather than thrown at once, so a run on a build without the
// screen still takes every shot and lists each claim it fails.
async function check(checks: Checks, claim: string, prove: () => Promise<void>): Promise<void> {
  try {
    await prove();
    await checks.note(`ok: ${claim}`);
  } catch (error) {
    checks.failed.push(claim);
    await checks.note(`NOT: ${claim}: ${errorMessage(error)}`);
  }
}

function sectionRegion(window: Page, title: SectionTitle): Locator {
  return window.getByRole("region", { name: title, exact: true });
}

// Settings fills the window: the session sidebar and the side panel are gone, and the one section
// on screen is the one named.
async function requireOnly(window: Page, title: SectionTitle): Promise<void> {
  await sectionRegion(window, title).waitFor({ state: "visible" });
  const others = SECTIONS.filter((section) => section.title !== title);
  for (const other of others) {
    const count = await sectionRegion(window, other.title).count();
    if (count !== 0) {
      throw new DriverFailure(`${other.title} renders beside ${title}`);
    }
  }
  const heading = await window.getByRole("heading", { level: 1 }).innerText();
  if (heading !== title) {
    throw new DriverFailure(`the page is headed "${heading}", not "${title}"`);
  }
  const sessionControls = await window.getByRole("button", { name: "New session" }).count();
  const sidePanels = await window.getByRole("complementary", { name: SIDE_PANEL_NAME }).count();
  if (sessionControls !== 0 || sidePanels !== 0) {
    throw new DriverFailure(
      `the sidebar (${String(sessionControls)}) or the side panel (${String(sidePanels)}) is still on screen`,
    );
  }
}

function settingsNav(window: Page): Locator {
  return window.getByRole("navigation", { name: "Settings sections" });
}

async function leaveSettings(window: Page): Promise<void> {
  if ((await settingsNav(window).count()) !== 0) {
    await window.keyboard.press("Escape");
  }
  await settingsNav(window).waitFor({ state: "detached" });
}

async function openStep(window: Page, label: string): Promise<void> {
  await window.getByRole("button", { name: label }).click();
  await window.waitForTimeout(SETTLE_MS);
}

async function showSection(window: Page, title: SectionTitle): Promise<void> {
  await settingsNav(window).getByRole("button", { name: title, exact: true }).click();
  await window.waitForTimeout(SETTLE_MS);
}

async function shootSections(window: Page, dir: string, note: Note): Promise<string[]> {
  const shots: string[] = [];
  for (const theme of THEMES) {
    await showSection(window, "Appearance");
    await pickTheme(window, theme.label);
    await expectVisible(window, "Saved");
    for (const section of SECTIONS) {
      await showSection(window, section.title);
      const path = await shoot(window, dir, UNIT, `settings-${section.slug}-${theme.slug}`);
      shots.push(path);
      await note(`${section.title}, ${theme.slug}: ${path}`);
      await window.waitForTimeout(HOLD_MS);
    }
  }
  return shots;
}

const SETTINGS_SCREEN: Scenario = {
  name: "settings-screen",
  unit: UNIT,
  gate: null,
  act: async ({ dir, bootstrap, note, onWindow }) => {
    const seeded = await bootstrap();
    const repositoryPath = await seedRepository();
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);
    const checks: Checks = { note, failed: [] };
    const clip = startClip(dir, CLIP_NAME);

    await expectVisible(window, "Finish setting up");
    await note("the main area opened on the onboarding checklist");
    await window.waitForTimeout(HOLD_MS);

    await openStep(window, "Connect to Metabase");
    await check(checks, "the checklist's Connect to Metabase opens Metabase alone", async () => {
      await requireOnly(window, "Metabase");
    });
    await window.waitForTimeout(HOLD_MS);
    await signIn(window, seeded, note);
    await expectVisible(window, seeded.adminApiKeyEmail);
    await note(`signed in to ${seeded.baseUrl} as ${seeded.adminApiKeyEmail}`);
    await leaveSettings(window);

    await openStep(window, "Pick a repository");
    await check(checks, "the checklist's Pick a repository opens Repository alone", async () => {
      await requireOnly(window, "Repository");
    });
    await window.waitForTimeout(HOLD_MS);
    await chooseRepository(window, repositoryPath);
    await expectVisible(window, repositoryPath);
    await note(`repository ${repositoryPath}`);
    await leaveSettings(window);

    await window.keyboard.press(PALETTE_CHORD);
    await window
      .getByRole("dialog", { name: PALETTE_NAME })
      .getByRole("combobox")
      .fill("Agents settings");
    await window.waitForTimeout(HOLD_MS);
    await window.keyboard.press("Enter");
    await window.waitForTimeout(SETTLE_MS);
    await check(checks, "the palette's Agents settings opens Agents alone", async () => {
      await requireOnly(window, "Agents");
    });

    const shots = await shootSections(window, dir, note);

    await check(checks, `${SETTINGS_BACK_LABEL} in the strip returns to the sessions`, async () => {
      await window.getByRole("button", { name: SETTINGS_BACK_LABEL, exact: true }).click();
      await window.locator("[data-prompt]").waitFor({ state: "visible" });
    });
    await window.waitForTimeout(HOLD_MS);
    await leaveSettings(window);

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.waitForTimeout(SETTLE_MS);
    await window.keyboard.press(NEW_SESSION_CHORD);
    await check(checks, `${NEW_SESSION_CHORD} from Settings opens a new session`, async () => {
      await window.locator("[data-prompt]").waitFor({ state: "visible" });
    });
    await leaveSettings(window);
    await window.waitForTimeout(SETTLE_MS);

    const recorded = await clip.stop();
    await note(`clip ${recorded.path}, ${recorded.seconds.toFixed(1)} s`);
    if (checks.failed.length > 0) {
      throw new DriverFailure(`not shown: ${checks.failed.join("; ")}`);
    }
    await closeApp(running);
    return shots.join(", ");
  },
};

export const SETTINGS_SCREEN_SCENARIOS: readonly Scenario[] = [SETTINGS_SCREEN];
