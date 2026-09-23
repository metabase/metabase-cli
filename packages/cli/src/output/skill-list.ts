import { z } from "zod";

import { RequirementFailure } from "@metabase/client/version/preflight-error";

import type { SkillServerLookup } from "../core/skill-server";
import type { UnavailableSkill } from "../core/skills";
import { listTruncationNotice, warn } from "./notice";

export interface SkillListRow {
  name: string;
  description: string;
}

const UnavailableSkillJson: z.ZodType<UnavailableSkill> = z.object({
  name: z.string(),
  failure: RequirementFailure,
});

export const UnavailableSkills = z
  .array(UnavailableSkillJson)
  .nullable()
  .describe(
    "Skills left out because the connected server lacks a feature they need, each with the client's account of the first one missing; `null` when nothing was filtered — `--unfiltered` was passed, or there was no server to filter by.",
  );

export const unfilteredFlag = {
  unfiltered: {
    type: "boolean",
    description:
      "Print the selected skills as written, regardless of what the connected server supports",
  },
} as const;

// `server` is `null` when `--unfiltered` skipped the lookup, which asked for the lot and gets no note.
export function skillFilterNotices(
  unavailable: readonly UnavailableSkill[] | null,
  server: SkillServerLookup | null,
): string[] {
  if (server === null) {
    return [];
  }
  if (unavailable !== null) {
    return unavailable.map(
      (skill) =>
        `Skipped skill "${skill.name}": ${skill.failure.detail} Pass --unfiltered to print it anyway.`,
    );
  }
  switch (server.kind) {
    case "found": {
      return [];
    }
    case "no-credential": {
      return [`Skills are unfiltered: ${server.reason}.`];
    }
    case "unreachable": {
      return [`Skills are unfiltered: the server could not be probed (${server.reason}).`];
    }
  }
}

const DEFAULT_TERMINAL_WIDTH = 80;
const MIN_WRAP_WIDTH = 24;
const DESCRIPTION_INDENT = "  ";

export function renderSkillList(rows: readonly SkillListRow[], maxBytes: number): void {
  if (rows.length === 0) {
    process.stdout.write("(no results)\n");
    return;
  }
  const width = wrapWidth();
  const blocks = rows.map((row) => renderSkillBlock(row, width));
  const fullText = blocks.join("");
  const fullBytes = Buffer.byteLength(fullText, "utf8");
  if (maxBytes <= 0 || fullBytes <= maxBytes) {
    process.stdout.write(fullText);
    return;
  }

  let used = 0;
  let kept = "";
  for (const block of blocks) {
    const next = used + Buffer.byteLength(block, "utf8");
    if (next > maxBytes) {
      break;
    }
    used = next;
    kept += block;
  }
  process.stdout.write(kept);
  warn(listTruncationNotice(fullBytes));
}

function renderSkillBlock(row: SkillListRow, width: number): string {
  const lines = wrapText(row.description, width - DESCRIPTION_INDENT.length);
  const body = lines.map((line) => DESCRIPTION_INDENT + line).join("\n");
  return body === "" ? `${row.name}\n\n` : `${row.name}\n${body}\n\n`;
}

function wrapText(text: string, width: number): string[] {
  const limit = Math.max(width, MIN_WRAP_WIDTH);
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

function wrapWidth(): number {
  const columns = process.stdout.columns;
  return typeof columns === "number" && columns > 0 ? columns : DEFAULT_TERMINAL_WIDTH;
}
