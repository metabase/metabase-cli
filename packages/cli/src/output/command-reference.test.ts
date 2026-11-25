import { posix } from "node:path";

import { defineCommand } from "citty";
import type { CommandDef, SubCommandsDef } from "citty";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ConfigError, errorMessage } from "@metabase/client/errors";
import { featureAvailability } from "@metabase/client/version/features";

import { SHARED_FLAG_SETS } from "../commands/flags";
import { defineCommandGroup } from "../commands/group";
import { defineMetabaseCommand } from "../commands/runtime";
import { GUIDES_DIR, loadGuides, parseGuide } from "../core/guides";
import main from "../main";
import { anchorFor, renderCommandReference, type SharedFlagSet } from "./command-reference";

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

const GENERATED_COMMENT =
  "# Generated in https://github.com/metabase/metabase-cli. Edit it there: a change made here is lost.";

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

function renderFixture(root: CommandDef): Promise<ReadonlyMap<string, string>> {
  return renderCommandReference({ root, sharedFlagSets: FIXTURE_SETS, guides: [] });
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
        GENERATED_COMMENT,
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
        "| Argument or flag | Description |",
        "| --- | --- |",
        "| `<id>` | Thing id. |",
        "| `--interval <value>` | Polling interval in ms. Default: `2000`. |",
        "",
        "Takes the [verbose](index.md#verbose-flags) flags.",
        "",
        `Needs \`transforms\` (${featureAvailability("transforms")}).`,
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

  it("lists the top-level commands, the schema commands and each shared flag set on the index page", async () => {
    const root = defineCommand({
      meta: { name: "mb", version: "1.2.3" },
      subCommands: { thing: groupOf({ list }) },
    });

    const index = await renderedPage(root, "index.md");

    expect(index).toBe(
      [
        "---",
        GENERATED_COMMENT,
        'title: "Metabase CLI command reference"',
        'summary: "Each mb command, with its arguments, flags, examples, and the Metabase features it needs."',
        "---",
        "",
        "# Metabase CLI command reference",
        "",
        "`mb` is the command-line client for Metabase. To install it and log in, see [Metabase CLI](https://www.metabase.com/docs/latest/installation-and-operation/metabase-cli).",
        "",
        "These pages describe version 1.2.3 of the CLI.",
        "",
        "## Commands",
        "",
        "| Command | Description |",
        "| --- | --- |",
        "| [mb thing](thing.md) | Manage things. |",
        "",
        "Some commands and flags need a newer Metabase or a paid plan. Their text names the feature they need, with the servers that have it: `v59+` is Metabase 59 and later, and `token dependencies` is a license that includes the `dependencies` token feature.",
        "",
        "`mb schema <command>` prints the JSON Schema of the body a command reads, and `mb schema <command> --output` the schema of what it prints.",
        "",
        "## Shared flags",
        "",
        "Many commands take one or more of these flag sets. Each page names the sets its commands take.",
        "",
        "### Verbose flags",
        "",
        "| Flag | Description |",
        "| --- | --- |",
        "| `--verbose` | Say more. |",
        "",
        "### Region flags",
        "",
        "| Flag | Description |",
        "| --- | --- |",
        "| `--region <value>` | Region to read. Default: `eu`. |",
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

    expect(page).toContain("| `--verbose` | Print each thing in full. |");
    expect(page).not.toContain("Takes the");
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
      guides: [],
    });

    expect(files.get("thing.md")).toContain("Takes the [outer](index.md#outer-flags) flags.\n");
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
        "| Flag | Description |",
        "| --- | --- |",
        "| `--max-rows <value>` | Rows to show. |",
        "| `-m, --message <value>` | Required. Commit message. |",
        "| `--run-log, --no-run-log` | Keep a run log. Default: `true`. |",
        "| `--dry-run` | Check without writing. |",
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
      '| `--schema <value>` | Schema id "&lt;db>:&lt;schema>" or `<raw>`, a \\| b. |',
    );
  });

  it("says once on a page what every command on it takes and needs", async () => {
    const status = defineMetabaseCommand({
      meta: { name: "status" },
      requires: ["gitSync.isDirty"],
      args: { ...verboseFlags },
      run() {
        return;
      },
    });
    const check = defineMetabaseCommand({
      meta: { name: "check" },
      requires: ["gitSync.hasRemoteChanges", "gitSync.isDirty"],
      args: { ...verboseFlags, ...regionFlags },
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ thing: groupOf({ status, check }) }), "thing.md");

    expect(page).toBe(
      [
        "---",
        GENERATED_COMMENT,
        'title: "mb thing"',
        'summary: "Manage things."',
        "---",
        "",
        "# mb thing",
        "",
        "Manage things.",
        "",
        "Every command on this page takes the [verbose](index.md#verbose-flags) flags.",
        "",
        `Every command on this page needs \`remoteSync\` (${featureAvailability("remoteSync")}).`,
        "",
        "## mb thing status",
        "",
        "```sh",
        "mb thing status [flags]",
        "```",
        "",
        "## mb thing check",
        "",
        "```sh",
        "mb thing check [flags]",
        "```",
        "",
        "Also takes the [region](index.md#region-flags) flags.",
        "",
        `Also needs \`remoteSyncRemoteChanges\` (${featureAvailability("remoteSyncRemoteChanges")}).`,
        "",
      ].join("\n"),
    );
  });

  it("leaves out of a command's skills the ones its page's header points to", async () => {
    const create = defineMetabaseCommand({
      meta: { name: "create" },
      skills: [
        { skill: "mbql", purpose: "author the query" },
        { skill: "native-sql", purpose: "author a native query" },
      ],
      requires: null,
      args: {},
      run() {
        return;
      },
    });
    const thing = defineCommandGroup({
      name: "thing",
      description: "Manage things",
      skills: [{ skill: "mbql", purpose: "query bodies" }],
      subCommands: { create: () => Promise.resolve(create) },
    });

    const page = await renderedPage(rootOf({ thing }), "thing.md");

    expect(page).toBe(
      [
        "---",
        GENERATED_COMMENT,
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
        "- `mb skills get mbql`: query bodies",
        "",
        "## mb thing create",
        "",
        "```sh",
        "mb thing create",
        "```",
        "",
        "Agent skills:",
        "",
        "- `mb skills get native-sql`: author a native query",
        "",
      ].join("\n"),
    );
  });

  it("names no default for a flag that is off unless given", async () => {
    const reset = defineMetabaseCommand({
      meta: { name: "reset" },
      requires: null,
      args: { force: { type: "boolean", description: "Overwrite", default: false } },
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ thing: groupOf({ reset }) }), "thing.md");

    expect(page).toContain("| `--force` | Overwrite. |\n");
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
        GENERATED_COMMENT,
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

    expect([...files.keys()]).toEqual(["index.md", "thing.md"]);
    expect(files.get("thing.md")).not.toContain("mb thing purge");
  });

  it("opens a group page with the group's details, after the header and before the commands", async () => {
    const thing = defineCommandGroup({
      name: "thing",
      description: "Manage things",
      details: "## Rows\n\nA thing holds rows.",
      subCommands: { list: () => Promise.resolve(list) },
    });

    const page = await renderedPage(rootOf({ thing }), "thing.md");

    expect(page).toContain(
      "# mb thing\n\nManage things.\n\n## Rows\n\nA thing holds rows.\n\n## mb thing list\n",
    );
  });

  it("refuses a command whose details hold a heading", async () => {
    const headed = defineMetabaseCommand({
      meta: { name: "list" },
      details: "## Rows\n\nA thing holds rows.",
      requires: null,
      args: {},
      run() {
        return;
      },
    });

    const error = await renderFixture(rootOf({ thing: groupOf({ list: headed }) })).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConfigError);
    expect(errorMessage(error)).toBe(
      "mb thing list has a heading in its details, which only a group's details may hold",
    );
  });

  it.each([
    ["{% if x %}", "{% raw %}{% if x %}{% endraw %}"],
    ["a lone {{", "a lone {% raw %}{{{% endraw %}"],
    ["a lone {%", "a lone {% raw %}{%{% endraw %}"],
  ])("keeps Liquid from reading %j", async (details, escaped) => {
    const tag = defineMetabaseCommand({
      meta: { name: "tag" },
      details,
      requires: null,
      args: {},
      run() {
        return;
      },
    });

    expect(await renderedPage(rootOf({ tag }), "tag.md")).toContain(`\n\n${escaped}\n\n`);
  });

  it("wraps each `{{…}}` in a page's body in raw tags, and leaves the front matter as it is", async () => {
    const tag = defineMetabaseCommand({
      meta: { name: "tag", description: "Print {{tag}} as typed" },
      requires: null,
      args: {},
      examples: ["mb tag '{{snippet: Name}}'"],
      run() {
        return;
      },
    });

    const page = await renderedPage(rootOf({ tag }), "tag.md");

    expect(page).toBe(
      [
        "---",
        GENERATED_COMMENT,
        'title: "mb tag"',
        'summary: "Print {{tag}} as typed."',
        "---",
        "",
        "# mb tag",
        "",
        "Print {% raw %}{{tag}}{% endraw %} as typed.",
        "",
        "```sh",
        "mb tag",
        "```",
        "",
        "Examples:",
        "",
        "```sh",
        "mb tag '{% raw %}{{snippet: Name}}{% endraw %}'",
        "```",
        "",
      ].join("\n"),
    );
  });
});

describe("renderCommandReference with guides", () => {
  async function renderedGuide(body: readonly string[]): Promise<string> {
    const guide = parseGuide(
      "export",
      ["---", 'title: "Export rows"', 'summary: "How to export {{rows}}"', "---", ...body, ""].join(
        "\n",
      ),
    );
    const files = await renderCommandReference({
      root: rootOf({ thing: groupOf({ list }) }),
      sharedFlagSets: [],
      guides: [guide],
    });
    const page = files.get("guides/export.md");
    if (page === undefined) {
      throw new Error("no guide page");
    }
    return page;
  }

  it("lists each guide on the index, before the commands", async () => {
    const files = await renderCommandReference({
      root: rootOf({ thing: groupOf({ list }) }),
      sharedFlagSets: [],
      guides: [
        parseGuide("export", '---\ntitle: "A | B"\nsummary: "How to export"\n---\n'),
        parseGuide("search", '---\ntitle: "Search"\nsummary: "How to search."\n---\n'),
      ],
    });

    expect([...files.keys()]).toEqual([
      "index.md",
      "thing.md",
      "guides/export.md",
      "guides/search.md",
    ]);
    expect(files.get("index.md")).toContain(
      [
        "## Guides",
        "",
        "| Guide | Description |",
        "| --- | --- |",
        "| [A \\| B](guides/export.md) | How to export. |",
        "| [Search](guides/search.md) | How to search. |",
        "",
        "## Commands",
      ].join("\n"),
    );
  });

  it("heads the page with the front matter's title, and wraps each `{{…}}` in its body in raw tags", async () => {
    const page = await renderedGuide(["", "Pass `{{tag}}`.", "", "```sh", "echo '{{x}}'", "```"]);

    expect(page).toBe(
      [
        "---",
        GENERATED_COMMENT,
        'title: "Export rows"',
        'summary: "How to export {{rows}}."',
        "---",
        "",
        "# Export rows",
        "",
        "Pass `{% raw %}{{tag}}{% endraw %}`.",
        "",
        "```sh",
        "echo '{% raw %}{{x}}{% endraw %}'",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("opens each section between requires markers with the servers it needs, under its heading", async () => {
    const page = await renderedGuide([
      "",
      "Intro.",
      "",
      "<!-- requires: transforms -->",
      "",
      "## Transforms",
      "",
      "Run one.",
      "",
      "<!-- /requires -->",
      "",
      "<!-- requires: transforms, measures -->",
      "",
      "Use both.",
      "",
      "<!-- /requires -->",
      "",
      "Outro.",
    ]);

    const transforms = `\`transforms\` (${featureAvailability("transforms")})`;
    const measures = `\`measures\` (${featureAvailability("measures")})`;
    expect(page).toContain(
      [
        "# Export rows",
        "",
        "Intro.",
        "",
        "## Transforms",
        "",
        `Needs ${transforms}.`,
        "",
        "Run one.",
        "",
        `Needs ${transforms} and ${measures}.`,
        "",
        "Use both.",
        "",
        "Outro.",
        "",
      ].join("\n"),
    );
  });

  it("refuses a guide whose marker names no feature the client knows", async () => {
    const error = await renderedGuide([
      "",
      "<!-- requires: transfroms -->",
      "Run one.",
      "<!-- /requires -->",
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigError);
    expect(errorMessage(error)).toContain(
      "guides/export.md line 6: unknown feature in requires: transfroms",
    );
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

// A link with no page before its `#` points into the page it sits on, and any other page is named
// from the folder of the page that links to it.
function linkResolves(files: ReadonlyMap<string, string>, from: string, target: string): boolean {
  const [page, anchor] = target.split(ANCHOR_MARK);
  const samePage = page === undefined || page === "";
  const targetText = files.get(samePage ? from : posix.join(posix.dirname(from), page));
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

describe("the command reference", () => {
  it("links only to pages and headings it holds", async () => {
    const rendered = await renderCommandReference({
      root: main,
      sharedFlagSets: SHARED_FLAG_SETS,
      guides: loadGuides(GUIDES_DIR),
    });

    expect(brokenLinks(rendered)).toEqual([]);
  });
});
