import type { Locator, Page } from "playwright";

import { z } from "zod";

import { DriverFailure, closeApp } from "../app";
import {
  SETTINGS_BACK_LABEL,
  THEME_ENV_VAR,
  awaitRow,
  expectVisible,
  openWindow,
  shoot,
  start,
  type Note,
  type Scenario,
  themeSelect,
} from "../scenario";

import { FIXTURE_WORKSPACE, writeFixtureSession } from "./fixture";

const UNIT = "u9";
const FIXTURE_TURNS = 3;
const PALETTE_NAME = "Search sessions and actions";
const PALETTE_CHORD = "Control+K";
const TAB_PRESSES = 12;
const NEXT_FRAME =
  "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))";

function palette(window: Page): Locator {
  return window.getByRole("dialog", { name: PALETTE_NAME });
}

async function openPalette(window: Page): Promise<void> {
  await window.keyboard.press(PALETTE_CHORD);
  await palette(window).getByRole("combobox").waitFor({ state: "visible" });
}

// Base UI traps focus with guard elements beside the popup in the same portal, and a guard hands
// focus back on the next animation frame; the trap has failed only once focus reaches the page
// underneath after that frame.
async function focusStaysIn(window: Page, note: Note): Promise<void> {
  for (let press = 0; press < TAB_PRESSES; press += 1) {
    await window.keyboard.press("Tab");
    await window.evaluate(NEXT_FRAME);
    const inside = await window.evaluate(
      `document.activeElement !== document.body && !document.getElementById("root").contains(document.activeElement)`,
    );
    if (inside !== true) {
      const where: unknown = await window.evaluate(
        "document.activeElement?.outerHTML.slice(0, 200)",
      );
      throw new DriverFailure(
        `focus left the palette after ${String(press + 1)} Tab presses, for ${String(where)}`,
      );
    }
  }
  await note(`${String(TAB_PRESSES)} Tab presses kept focus inside the palette`);
}

interface FocusDrawing {
  readonly element: string;
  readonly outline: string;
  readonly shadow: string;
}

// A control shows focus either as the global outline or, for a text field, as the primitive's ring,
// which is a box shadow.
async function focusDrawingOf(window: Page): Promise<FocusDrawing> {
  const [element, outline, shadow] = z
    .tuple([z.string(), z.string(), z.string()])
    .parse(
      await window.evaluate(
        `(() => { const el = document.activeElement; const style = getComputedStyle(el); return [el.getAttribute("aria-label") ?? el.textContent ?? el.tagName, style.outlineStyle, style.boxShadow]; })()`,
      ),
    );
  return { element, outline, shadow };
}

const KEYBOARD: Scenario = {
  name: "keyboard",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const fixture = await writeFixtureSession(FIXTURE_TURNS, FIXTURE_WORKSPACE);
    const running = await start(fixture.userDataDir, process.env[THEME_ENV_VAR]);
    const window = await openWindow(running, onWindow);
    await expectVisible(window, fixture.title);
    const shots: string[] = [];

    await openPalette(window);
    await note(`${PALETTE_CHORD} opened the palette with the search field focused`);
    shots.push(await shoot(window, dir, UNIT, "palette"));
    await focusStaysIn(window, note);

    await palette(window).getByRole("combobox").fill("orders");
    shots.push(await shoot(window, dir, UNIT, "palette-query"));
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowUp");
    await window.keyboard.press("Enter");
    await awaitRow(window, "checkpoint");
    await note(`typing "orders" and Enter opened ${fixture.title}`);

    await openPalette(window);
    await palette(window).getByRole("combobox").fill("appearance");
    await window.keyboard.press("Enter");
    await themeSelect(window).waitFor({ state: "visible" });
    await note("the palette opened Appearance settings");

    await openPalette(window);
    await window.keyboard.press("Escape");
    await palette(window).waitFor({ state: "hidden" });
    await themeSelect(window).waitFor({ state: "visible" });
    await note("Escape closed the palette and left Settings open beneath it");

    await window.keyboard.press("Escape");
    await window
      .getByRole("button", { name: SETTINGS_BACK_LABEL, exact: true })
      .waitFor({ state: "hidden" });
    await note("a second Escape closed Settings");

    await window.locator("[data-prompt]").focus();
    await window.keyboard.press("Escape");
    await window.keyboard.press("Tab");
    const focus = await focusDrawingOf(window);
    await note(
      `Tab after leaving the composer focused "${focus.element}": outline ${focus.outline}, shadow ${focus.shadow}`,
    );
    if (focus.outline === "none" && focus.shadow === "none") {
      throw new DriverFailure("the focused control shows no focus ring");
    }
    shots.push(await shoot(window, dir, UNIT, "focus"));

    await closeApp(running);
    return shots.join(", ");
  },
};

export const KEYBOARD_SCENARIOS: readonly Scenario[] = [KEYBOARD];
