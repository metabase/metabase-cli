import { DriverFailure } from "../app";
import type { Scenario } from "../scenario";

import { AUDIT_SCENARIOS } from "./audit";
import { CHANGES_SCENARIOS } from "./changes";
import { CHANGES_STATE_SCENARIOS } from "./changes-states";
import { CHROME_SCENARIOS } from "./chrome";
import { COMPOSER_SCENARIOS } from "./composer";
import { CONNECTION_SCENARIOS } from "./connection";
import { FILES_SCENARIOS } from "./files";
import { KEYBOARD_SCENARIOS } from "./keyboard";
import { METABASE_SCENARIOS } from "./metabase";
import { METABASE_PANEL_SCENARIOS } from "./metabase-panel";
import { PACKAGING_SCENARIOS } from "./packaging";
import { PERF_SCENARIOS } from "./perf";
import { RESIZE_SCENARIOS } from "./resize";
import { REVIEW_SCENARIOS } from "./review";
import { SESSION_SCENARIOS } from "./sessions";
import { SETTINGS_SCENARIOS } from "./settings";
import { SETTINGS_SCREEN_SCENARIOS } from "./settings-screen";
import { SIDEBAR_SCENARIOS } from "./sidebar";
import { TIMELINE_SCENARIOS } from "./timeline";
import { TYPE_SCENARIOS } from "./type";

export const SCENARIOS: readonly Scenario[] = [
  ...SETTINGS_SCENARIOS,
  ...SESSION_SCENARIOS,
  ...TIMELINE_SCENARIOS,
  ...CHANGES_SCENARIOS,
  ...METABASE_SCENARIOS,
  ...PACKAGING_SCENARIOS,
  ...KEYBOARD_SCENARIOS,
  ...AUDIT_SCENARIOS,
  ...CONNECTION_SCENARIOS,
  ...PERF_SCENARIOS,
  ...REVIEW_SCENARIOS,
  ...CHROME_SCENARIOS,
  ...TYPE_SCENARIOS,
  ...RESIZE_SCENARIOS,
  ...CHANGES_STATE_SCENARIOS,
  ...COMPOSER_SCENARIOS,
  ...SETTINGS_SCREEN_SCENARIOS,
  ...SIDEBAR_SCENARIOS,
  ...METABASE_PANEL_SCENARIOS,
  ...FILES_SCENARIOS,
];

export function pickScenario(name: string | undefined): Scenario {
  const found = SCENARIOS.find((scenario) => scenario.name === name);
  if (found === undefined) {
    throw new DriverFailure(
      `unknown scenario ${String(name)}; known: ${SCENARIOS.map((scenario) => scenario.name).join(", ")}`,
    );
  }
  return found;
}
