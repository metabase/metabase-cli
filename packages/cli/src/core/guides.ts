import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";

import { parseYaml } from "../runtime/yaml";
import { readMarkdownLines, splitFrontmatter, type MarkdownLine } from "./markdown";

// The guides' source, which only the script that writes the pages and its tests read: the CLI
// bundle holds none of this module.
export const GUIDES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../guides");

// Guides are served from a folder of their own, since a command's page has its command's name.
const GUIDES_FOLDER = "guides";
const GUIDE_EXTENSION = ".md";

const GuideFrontmatter = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
});

// A page title is the front matter's, so a second one in the body would show it twice.
const TITLE_HEADING = /^#\s/;
// A version a guide states goes stale when a feature rule changes; a passage between `requires`
// markers gets its servers from the rule instead.
const HAND_WRITTEN_VERSION = /\b(?:v|Metabase |versions? )\d{2,}\b/;

export interface Guide {
  name: string;
  // The guide's path beside the reference pages, which errors name it by.
  file: string;
  title: string;
  summary: string;
  body: readonly MarkdownLine[];
}

export function loadGuides(dir: string): Guide[] {
  return readdirSync(dir)
    .filter((file) => extname(file) === GUIDE_EXTENSION)
    .toSorted()
    .map((file) =>
      parseGuide(basename(file, GUIDE_EXTENSION), readFileSync(join(dir, file), "utf8")),
    );
}

export function parseGuide(name: string, content: string): Guide {
  const file = `${GUIDES_FOLDER}/${name}${GUIDE_EXTENSION}`;
  const { yaml, body, bodyLine } = splitFrontmatter(content, file);
  const { title, summary } = parseYaml(yaml, GuideFrontmatter, { source: file });
  const lines = readMarkdownLines(body, bodyLine);
  for (const line of lines) {
    if (line.place === "prose") {
      assertGuideProse(line, file);
    }
  }
  return { name, file, title, summary, body: lines };
}

function assertGuideProse(line: MarkdownLine, file: string): void {
  if (TITLE_HEADING.test(line.text)) {
    throw new ConfigError(
      `${file} line ${line.lineNumber}: the page's title comes from its front matter, so a guide's headings start at ##`,
    );
  }
  const version = HAND_WRITTEN_VERSION.exec(line.text);
  if (version !== null) {
    throw new ConfigError(
      `${file} line ${line.lineNumber}: names the version "${version[0]}"; put the passage between requires markers, which name the servers it needs`,
    );
  }
}
