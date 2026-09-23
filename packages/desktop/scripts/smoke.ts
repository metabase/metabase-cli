import { join } from "node:path";

import type { Theme } from "../src/contracts/settings";
import { readThemeOverride } from "../src/main/settings/theme";

import {
  DriverFailure,
  definedEnv,
  PRODUCT_NAME,
  WINDOW_TIMEOUT_MS,
  closeApp,
  evidenceDir,
  launchApp,
  timestamp,
} from "./app";

// The app launches with no stored preference and Xvfb reports no dark system theme, so this is what
// the window paints when the theme variable says nothing.
const UNSET_THEME: Theme = "light";
const THEME_ATTRIBUTE_SELECTOR = "html[data-theme]";
const SCREENSHOT_NAME: Readonly<Record<Theme, string>> = {
  light: "u0-shell",
  dark: "u0-shell-dark",
};

async function main(): Promise<void> {
  const dir = await evidenceDir(process.env);
  const theme = readThemeOverride(process.env) ?? UNSET_THEME;

  const running = await launchApp({
    userDataDir: null,
    extraArgs: [],
    env: definedEnv(process.env),
  });
  const window = await running.app.firstWindow({ timeout: WINDOW_TIMEOUT_MS });
  await window
    .locator(THEME_ATTRIBUTE_SELECTOR)
    .waitFor({ state: "attached", timeout: WINDOW_TIMEOUT_MS });
  await window.evaluate("document.fonts.ready");

  const title = await window.title();
  if (title !== PRODUCT_NAME) {
    throw new DriverFailure(`Window title is "${title}", expected "${PRODUCT_NAME}"`);
  }
  const appliedTheme = await window.locator("html").getAttribute("data-theme");
  if (appliedTheme !== theme) {
    throw new DriverFailure(`Renderer applied theme "${appliedTheme}", expected "${theme}"`);
  }

  const screenshotPath = join(dir, `${timestamp()}_${SCREENSHOT_NAME[theme]}.png`);
  await window.screenshot({ path: screenshotPath });
  await closeApp(running);

  process.stdout.write(`smoke ok: theme=${theme} title="${title}" screenshot=${screenshotPath}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`smoke failed: ${message}\n`);
  process.exitCode = 1;
});
