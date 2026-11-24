import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, ValidationError } from "@metabase/client/errors";

import { loadGuides, parseGuide } from "./guides";

function guideText(body: string): string {
  return `---\ntitle: "Export"\nsummary: "How to export."\n---\n\n${body}\n`;
}

describe("parseGuide", () => {
  it("reads the front matter, and the body with its lines counted in the file", () => {
    expect(parseGuide("export", guideText("## First"))).toEqual({
      name: "export",
      file: "guides/export.md",
      title: "Export",
      summary: "How to export.",
      body: [
        { lineNumber: 5, text: "", place: "prose" },
        { lineNumber: 6, text: "## First", place: "prose" },
        { lineNumber: 7, text: "", place: "prose" },
      ],
    });
  });

  it.each([
    "---\ntitle: Export\n---\n",
    "---\ntitle: A\nsummary: B\nrequires: [transforms]\n---\n",
  ])("refuses front matter other than a title and a summary: %j", (content) => {
    expect(() => parseGuide("export", content)).toThrow(ValidationError);
    expect(() => parseGuide("export", content)).toThrow(
      "guides/export.md: value did not match expected schema",
    );
  });

  it("refuses a level-1 heading, which the front matter's title already is", () => {
    expect(() => parseGuide("export", guideText("# Export"))).toThrow(ConfigError);
    expect(() => parseGuide("export", guideText("# Export"))).toThrow(
      new ConfigError(
        "guides/export.md line 6: the page's title comes from its front matter, so a guide's headings start at ##",
      ),
    );
  });

  it.each([
    ["Needs `v64` or newer.", "v64"],
    ["Works from Metabase 61 on.", "Metabase 61"],
  ])("refuses a version written by hand: %s", (body, version) => {
    expect(() => parseGuide("export", guideText(body))).toThrow(ConfigError);
    expect(() => parseGuide("export", guideText(body))).toThrow(
      new ConfigError(
        `guides/export.md line 6: names the version "${version}"; put the passage between requires markers, which name the servers it needs`,
      ),
    );
  });

  it("takes a heading or a version inside a code block as the code's own", () => {
    const body = ["```sh", "# on Metabase 61", "echo v64", "```"].join("\n");

    expect(parseGuide("export", guideText(body)).body.map((line) => line.place)).toEqual([
      "prose",
      "fence",
      "code",
      "code",
      "fence",
      "prose",
    ]);
  });
});

describe("loadGuides", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mb-guides-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads each Markdown file, by name", () => {
    writeFileSync(join(dir, "search.md"), guideText("Search."));
    writeFileSync(join(dir, "export.md"), guideText("Export."));
    writeFileSync(join(dir, "notes.txt"), "not a guide");

    expect(loadGuides(dir).map((guide) => guide.file)).toEqual([
      "guides/export.md",
      "guides/search.md",
    ]);
  });
});
