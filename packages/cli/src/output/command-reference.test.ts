import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";
import type { CommandDef, SubCommandsDef } from "citty";
import * as fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError, errorMessage } from "@metabase/client/errors";
import { featureAvailability } from "@metabase/client/version/features";

import { SHARED_FLAG_SETS } from "../commands/flags";
import { defineCommandGroup } from "../commands/group";
import { defineMetabaseCommand } from "../commands/runtime";
import main from "../main";
import { readMarkdownFiles } from "../runtime/markdown-files";
import {
  anchorFor,
  NOTES_DIR,
  REFERENCE_DIR,
  renderCommandReference,
  type SharedFlagSet,
} from "./command-reference";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const verboseFlags = {
  verbose: { type: "boolean", description: "Say more" },
} as const;

const regionFlags = {
  region: { type: "string", description: "Region to read", default: "eu" },
} as const;

const FIXTURE_SETS: readonly SharedFlagSet[] = [
  { name: "verbose", flags: verboseFlags },
  { name: "region", flags: regionFlags },
];

function rootOf(subCommands: SubCommandsDef): CommandDef {
  return defineCommand({ meta: { name: "mb" }, subCommands });
}

function groupOf(subCommands: SubCommandsDef): CommandDef {
  return defineCommandGroup({ name: "thing", description: "Manage things", subCommands });
}

const list = defineMetabaseCommand({
  meta: { name: "list" },
  requires: null,
  args: {},
  run() {
    return;
  },
});

function renderFixture(
  root: CommandDef,
  notes: ReadonlyMap<string, string> = new Map(),
): Promise<ReadonlyMap<string, string>> {
  return renderCommandReference({ root, sharedFlagSets: FIXTURE_SETS, notes });
}

async function renderedPage(root: CommandDef, file: string): Promise<string> {
  const page = (await renderFixture(root)).get(file);
  if (page === undefined) {
    throw new Error(`no page ${file}`);
  }
  return page;
}

describe("renderCommandReference", () => {
  it("renders a group page with every part of a command section", async () => {
    const run = defineMetabaseCommand({
      meta: { name: "run", description: "Run a thing" },
      details: "Starts a run and returns.",
      requires: ["transform.run"],
      args: {
        ...verboseFlags,
        interval: { type: "string", description: "Polling interval in ms", default: "2000" },
        id: { type: "positional", description: "Thing id", required: true },
      },
      outputSchema: z.object({ id: z.number() }),
      examples: ["mb thing run 1", "mb thing run 1 --verbose"],
      run() {
        return;
      },
    });
    const thing = defineCommandGroup({
      name: "thing",
      description: "Manage things",
      skills: [{ skill: "transform", purpose: "body shape" }],
      subCommands: { run: () => Promise.resolve(run) },
    });

    const page = await renderedPage(rootOf({ thing }), "thing.md");

    expect(page).toBe(
      [
        "---",
        'title: "mb thing"',
        'summary: "Manage things."',
        "---",
        "",
        "# mb thing",
        "",
        "Manage things.",
        "",
        "Agent skills:",
        "",
        "- `mb skills get transform`: body shape",
        "",
        "## mb thing run",
        "",
        "Run a thing.",
        "",
        "Starts a run and returns.",
        "",
        "```sh",
        "mb thing run <id> [flags]",
        "```",
        "",
        "| Argument | Description |",
        "| --- | --- |",
        "| `<id>` | Thing id. |",
        "",
        "| Flag | Default | Description |",
        "| --- | --- | --- |",
        "| `--interval <value>` | `2000` | Polling interval in ms. |",
        "",
        "Shared flags: [verbose](README.md#verbose-flags).",
        "",
        `Needs: \`transforms\` (${featureAvailability("transforms")}).`,
        "",
        "Output schema: `mb schema thing run --output`.",
        "",
        "Examples:",
        "",
        "```sh",
        "mb thing run 1",
        "mb thing run 1 --verbose",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("lists the top-level commands and each shared flag set on the index page", async () => {
    const index = await renderedPage(rootOf({ thing: groupOf({ list }) }), "README.md");

    expect(index).toBe(
      [
        "---",
        'title: "Metabase CLI command reference"',
        'summary: "Each mb command, with its arguments, flags, examples, and the Metabase features it needs."',
        "---",
        "",
        "# Metabase CLI command reference",
        "",
        "## Commands",
        "",
        "| Command | Description |",
        "| --- | --- |",
        "| [mb thing](thing.md) | Manage things |",
        "",
        "## Shared flags",
        "",
        "Many commands take one or more of these flag sets. Each command names the sets it takes.",
        "",
        "### Verbose flags",
        "",
        "| Flag | Default | Description |",
        "| --- | --- | --- |",
        "| `--verbose` |  | Say more. |",
        "",
        "### Region flags",
        "",
        "| Flag | Default | Description |",
        "| --- | --- | --- |",
        "| `--region <value>` | `eu` | Region to read. |",
        "",
      ].join("\n"),
    );
  });

  it("keeps a shared flag the command redefines in the command's own table", async () => {
    const fullList = defineMetabaseCommand({
      meta: { name: "list" },
      requires: null,
      args: {
        ...verboseFlags,
        verbose: { type: "boolean", description: "Print each thing in full" },
      },
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ thing: groupOf({ list: fullList }) }), "thing.md");

    expect(page).toContain("| `--verbose` |  | Print each thing in full. |");
    expect(page).not.toContain("Shared flags:");
  });

  it("credits a flag to the first set that holds it", async () => {
    const outerFlags = {
      ...verboseFlags,
      quiet: { type: "boolean" },
    } as const;
    const outerList = defineMetabaseCommand({
      meta: { name: "list" },
      requires: null,
      args: { ...outerFlags },
      run() {
        return;
      },
    });
    const sets: readonly SharedFlagSet[] = [
      { name: "outer", flags: outerFlags },
      { name: "verbose", flags: verboseFlags },
    ];

    const files = await renderCommandReference({
      root: rootOf({ thing: groupOf({ list: outerList }) }),
      sharedFlagSets: sets,
      notes: new Map(),
    });

    expect(files.get("thing.md")).toContain("Shared flags: [outer](README.md#outer-flags).\n");
  });

  it("spells each flag the way citty binds it", async () => {
    const commit = defineMetabaseCommand({
      meta: { name: "commit", description: "Commit things" },
      requires: null,
      args: {
        maxRows: { type: "string", description: "Rows to show", alias: "max-rows" },
        message: { type: "string", description: "Commit message", alias: "m", required: true },
        runLog: { type: "boolean", description: "Keep a run log", default: true },
        dryRun: { type: "boolean", description: "Check without writing" },
      },
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ thing: groupOf({ commit }) }), "thing.md");

    expect(page).toContain(
      [
        "| Flag | Default | Description |",
        "| --- | --- | --- |",
        "| `--max-rows <value>` |  | Rows to show. |",
        "| `-m, --message <value>` |  | Required. Commit message. |",
        "| `--run-log, --no-run-log` | `true` | Keep a run log. |",
        "| `--dry-run` |  | Check without writing. |",
      ].join("\n"),
    );
  });

  it("escapes a `<` outside code spans, and every `|` in a table cell", async () => {
    const get = defineMetabaseCommand({
      meta: { name: "get", description: "Get a thing" },
      requires: null,
      args: {
        schema: { type: "string", description: 'Schema id "<db>:<schema>" or `<raw>`, a | b' },
      },
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ thing: groupOf({ get }) }), "thing.md");

    expect(page).toContain(
      '| `--schema <value>` |  | Schema id "&lt;db>:&lt;schema>" or `<raw>`, a \\| b. |',
    );
  });

  it("points a command that reads a body at its body schema", async () => {
    const create = defineMetabaseCommand({
      meta: { name: "create", description: "Create a thing" },
      requires: null,
      args: {},
      inputSchema: z.object({ name: z.string() }),
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ thing: groupOf({ create }) }), "thing.md");

    expect(page).toContain("\n\nBody schema: `mb schema thing create`.\n");
  });

  it("names a group's alias and the command it runs without one", async () => {
    const login = defineMetabaseCommand({
      meta: { name: "login", description: "Log in" },
      requires: null,
      args: {},
      run() {
        return;
      },
    });
    const thing = defineCommandGroup({
      name: "thing",
      description: "Manage things",
      alias: "things",
      defaultCommand: "login",
      subCommands: { login: () => Promise.resolve(login) },
    });

    const page = await renderedPage(rootOf({ thing }), "thing.md");

    expect(page).toContain(
      "Manage things.\n\nAlias: `mb things`.\n\nWithout a command, `mb thing` runs `mb thing login`.\n",
    );
  });

  it("renders a top-level command without subcommands as a page of its own", async () => {
    const search = defineMetabaseCommand({
      meta: { name: "search", description: "Search things" },
      requires: null,
      args: { query: { type: "positional", description: "Words to find", required: false } },
      examples: ["mb search orders"],
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ search }), "search.md");

    expect(page).toBe(
      [
        "---",
        'title: "mb search"',
        'summary: "Search things."',
        "---",
        "",
        "# mb search",
        "",
        "Search things.",
        "",
        "```sh",
        "mb search [query]",
        "```",
        "",
        "| Argument | Description |",
        "| --- | --- |",
        "| `[query]` | Words to find. |",
        "",
        "Examples:",
        "",
        "```sh",
        "mb search orders",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("leaves a hidden command out of the reference", async () => {
    const purge = defineMetabaseCommand({
      meta: { name: "purge", hidden: true },
      requires: null,
      args: {},
      run() {
        return;
      },
    });
    const secret = defineCommand({
      meta: { name: "secret", hidden: true },
      subCommands: { list: () => Promise.resolve(list) },
    });

    const files = await renderFixture(rootOf({ thing: groupOf({ list, purge }), secret }));

    expect([...files.keys()]).toEqual(["README.md", "thing.md"]);
    expect(files.get("thing.md")).not.toContain("mb thing purge");
  });

  it("opens a page with its notes, after the header and before the commands", async () => {
    const notes = new Map([["thing.md", "A thing holds rows.\n"]]);

    const files = await renderFixture(rootOf({ thing: groupOf({ list }) }), notes);

    expect(files.get("thing.md")).toContain(
      "# mb thing\n\nManage things.\n\nA thing holds rows.\n\n## mb thing list\n",
    );
  });

  it("refuses notes that name no top-level command", async () => {
    const notes = new Map([["gone.md", "Stale notes.\n"]]);

    const error = await renderFixture(rootOf({ thing: groupOf({ list }) }), notes).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConfigError);
    expect(errorMessage(error)).toBe(`${NOTES_DIR}/gone.md names no top-level command`);
  });
});

const ANCHOR_CHARACTERS = /^[a-z0-9_-]*$/;

describe("anchorFor", () => {
  it("gives an anchor of lowercase letters, digits, `-` and `_`, which it keeps as it is", () => {
    fc.assert(
      fc.property(fc.string(), (heading) => {
        const anchor = anchorFor(heading);
        expect(ANCHOR_CHARACTERS.test(anchor)).toBe(true);
        expect(anchorFor(anchor)).toBe(anchor);
      }),
    );
  });

  it("makes the anchor GitHub gives a heading", () => {
    const headings = ["mb git-sync export-preflight", "Output flags", "Data_apps & more!"];

    expect(headings.map(anchorFor)).toEqual([
      "mb-git-sync-export-preflight",
      "output-flags",
      "data_apps--more",
    ]);
  });
});

const FENCE = "```";
const HEADING = /^#{1,6} (.+)$/;
const LINK = /\]\(([^)\s]+)\)/g;
const EXTERNAL_LINK = /^[a-z]+:/;
const ANCHOR_MARK = "#";

function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith(FENCE)) {
      inFence = !inFence;
      continue;
    }
    const heading = inFence ? undefined : HEADING.exec(line)?.[1];
    if (heading !== undefined) {
      anchors.add(anchorFor(heading));
    }
  }
  return anchors;
}

// A link with no page before its `#` points into the page it sits on.
function linkResolves(files: ReadonlyMap<string, string>, from: string, target: string): boolean {
  const [page, anchor] = target.split(ANCHOR_MARK);
  const samePage = page === undefined || page === "";
  const targetText = files.get(samePage ? from : page);
  if (targetText === undefined) {
    return false;
  }
  return anchor === undefined || headingAnchors(targetText).has(anchor);
}

function brokenLinks(files: ReadonlyMap<string, string>): string[] {
  const broken: string[] = [];
  for (const [file, text] of files) {
    for (const [, target] of text.matchAll(LINK)) {
      if (target === undefined || EXTERNAL_LINK.test(target)) {
        continue;
      }
      if (!linkResolves(files, file, target)) {
        broken.push(`${file}: ${target}`);
      }
    }
  }
  return broken;
}

describe("the committed command reference", () => {
  let rendered: ReadonlyMap<string, string>;

  beforeAll(async () => {
    const notes = await readMarkdownFiles(join(REPO_ROOT, NOTES_DIR));
    rendered = await renderCommandReference({
      root: main,
      sharedFlagSets: SHARED_FLAG_SETS,
      notes,
    });
  });

  it("matches what the command tree renders", async () => {
    const committed = await readMarkdownFiles(join(REPO_ROOT, REFERENCE_DIR));

    expect(
      Object.fromEntries(committed),
      `${REFERENCE_DIR} is stale: run \`bun run docs\``,
    ).toEqual(Object.fromEntries(rendered));
  });

  it("links only to pages and headings it holds", () => {
    expect(brokenLinks(rendered)).toEqual([]);
  });
});
