import { describe, expect, it } from "vitest";

import { ConfigError, errorMessage } from "@metabase/client/errors";

import { GUIDES_DIR, type Guide, loadGuides, parseGuide } from "../core/guides";
import main from "../main";
import { assertGuideCommands } from "./guide-commands";

const FENCE = "```";

function guideOf(language: string, code: string): Guide {
  const block = [`${FENCE}${language}`, code, FENCE].join("\n");
  return parseGuide("export", `---\ntitle: "Export"\nsummary: "How to export."\n---\n\n${block}\n`);
}

describe("assertGuideCommands", () => {
  it("takes commands the CLI takes, wherever they stand in a script", async () => {
    const script = [
      "ID=$(mb card list --json | jq -r '.data[0].id')",
      'mb card query "$ID" --export-format csv > rows.csv',
    ].join("\n");

    await expect(assertGuideCommands(guideOf("sh", script), main)).resolves.toBeUndefined();
  });

  it.each([
    [
      "sh",
      "echo start\nmb card list --limitt 5",
      "guides/export.md line 8: unknown flag: --limitt (mb card list --limitt 5)",
    ],
    ["bash", "X=$(mb card lst)", "guides/export.md line 7: unknown command: lst (mb card lst)"],
    ["sh", "mb card get 'x", "guides/export.md line 7: `'` is never closed"],
    [
      "sh",
      "echo 1 | xargs mb card get",
      "guides/export.md line 7: xargs runs mb, which is checked only as a command of its own",
    ],
    [
      "console",
      "$ mb card list",
      "guides/export.md line 6: the code block holds an mb command, so mark it sh: only a shell block's commands are checked",
    ],
    [
      "",
      "{}\nmb card list",
      "guides/export.md line 6: the code block holds an mb command, so mark it sh: only a shell block's commands are checked",
    ],
  ])("refuses a %j block that holds %j", async (language, code, message) => {
    const error = await assertGuideCommands(guideOf(language, code), main).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConfigError);
    expect(errorMessage(error)).toBe(message);
  });

  it("leaves the commands of other programs alone", async () => {
    const guide = guideOf("sh", "npm install -g @metabase/cli\njq --bogus .");

    await expect(assertGuideCommands(guide, main)).resolves.toBeUndefined();
  });
});

describe("the shipped guides", () => {
  it.each(loadGuides(GUIDES_DIR))("$file holds only commands the CLI takes", async (guide) => {
    await expect(assertGuideCommands(guide, main)).resolves.toBeUndefined();
  });
});
