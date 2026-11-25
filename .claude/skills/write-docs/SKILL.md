---
name: write-docs
description: Write or change the CLI's help text and docs — a command's `description`, `details`, flag descriptions or `examples`, a group's `details`, or a guide in `packages/cli/guides/`. Use whenever the user asks to "fix the help text", "update the docs", "document this flag" or "add a guide", and whenever a change alters what a command does (its output, exit codes, refusals, flags or defaults), since the help text is the source of the docs and has to change with it.
---

# write-docs

The help text is the docs. `scripts/generate-docs.ts` writes the command reference from the command tree, so each sentence prints in three places: `mb <command> --help`, `mb <command> --help --json`, and the command's page on the Metabase docs site. Write it once, for all three. `docs/architecture.md` ("Generated and vendored files") explains how the generator works.

## Where the text goes

Put a sentence in the narrowest place that owns it, and in only one.

| The text is about            | It goes in                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| One flag or argument         | Its `description` in `args`                                                                   |
| One command                  | The command's `details`                                                                       |
| A group, but no one command  | The group's `details` in `commands/<noun>/index.ts`                                           |
| A task across groups         | A guide in `packages/cli/guides/`, which links to the commands' pages and doesn't repeat them |
| A flag set many commands use | The set's definitions, with the set in `SHARED_FLAG_SETS` (`commands/flags.ts`)               |
| A workflow an agent follows  | A shipped skill in `packages/cli/skill-data/`                                                 |
| Installing, or a first login | `docs/installation-and-operation/metabase-cli.md` in metabase/metabase                        |

Command text never goes in the root `README.md`, and no copy of the generated pages is committed.

A page links to a shared set only when the command spreads every flag of the set as it is. Redefine one, and the set's other flags print again in the command's own table.

## What `details` can hold

Text of more than one block is an array joined with `"\n\n"`: one paragraph, heading, table or list per block.

- **Works in all three places:** paragraphs, tables, `**bold**`, code spans and links.
- **`##` headings:** in a group's `details` only. The build refuses one in a command's.
- **Lists, quotes and code blocks:** terminal help prints their lines as written, with no wrap, so keep them short. A code block can't hold a blank line.

Terminal help prints a link's text without its target, so the text has to make sense alone. A link to a command is its name and its section: ``[`mb table fields <table-id>`](table.md#mb-table-fields)``, or `#mb-db-get` on the same page.

Help prints `details` after the examples, and the page prints them before the usage line, so don't write "above" or "below".

## Facts come from code

Leave out what the renderers print: a flag's `default`, whether it's required, and, on the page, the features that `requires` reaches with the servers that hold them.

Any other fact copied into prose goes stale without a failure. Interpolate it:

- **A Metabase version:** never by hand. Name the feature, and let `featureAvailability` write its servers:

  ```ts
  const ICONS_FEATURE = "timelineExtendedIcons" satisfies FeatureName;
  `needs \`${ICONS_FEATURE}\` (${featureAvailability(ICONS_FEATURE)})`;
  ```

  A difference between servers that no feature names gets a rule in `packages/client/src/version/features.ts`. Help text alone is reason enough for one.

- **Enum values:** `${TableDataSource.options.join("|")}`.
- **Environment variables, limits and defaults:** the constant, such as `ENV_PROFILE` from `core/env.ts`.
- **JSON body fields:** nothing compares them with the schema. Read the command's `inputSchema` before you name one, and check the text again when the schema changes.

## Guides

One Markdown file in `packages/cli/guides/`. The index lists every Markdown file directly in the folder, so notes for contributors can't live there.

- The front matter holds a `title` and a `summary`, and nothing else. Headings start at `##`.
- An `mb` command goes in an `sh` block, where the build checks its name, flags and argument count. A flag's value and an inline code span aren't checked.
- A passage about a feature sits between `<!-- requires: <feature> -->` and `<!-- /requires -->`, each on its own line. The build refuses `v63`, `Metabase 63` and "version 63", but not every way to write a version.
- Links are relative to the written folder: `../card.md#mb-card-list`. A link to another Metabase doc is a full URL. Image files aren't copied.
- Write `<card-id>` in code only. In prose it becomes an HTML tag, and the site shows nothing.
- `{{…}}` and `{% … %}` are safe: the renderer adds their raw tags, so don't add your own.

## Style

- **Descriptions** of commands start with a verb: "List tables, optionally filtered". Descriptions of flags can be a fragment. Neither has a final period, because the page adds it. Help doesn't wrap a flag's description, so move a long one to `details`.
- **`details`** are full sentences. Put what the reader does first, then why.
- Use contractions ("can't", not "cannot"). Don't say a task is "easy" or "simple".
- Use backticks for code and bold for the Metabase UI: `**Admin** > **Settings**`.
- A heading says the point, in sentence case: "Walk a database from tables to fields", not "Traversal".
- Say what the CLI does, not what changed. No "now", "no longer" or "new".

## Check your work

A diff shows no page, so compare the pages yourself. Before you edit, save them:

```sh
rm -rf scratch/docs-before && mkdir -p scratch && bun run docs && cp -R packages/cli/dist/docs scratch/docs-before
```

After you edit:

```sh
bun run docs; diff -ru scratch/docs-before packages/cli/dist/docs
bin/mb-dev <command> --help | cat
bun run check
```

Every changed line in the diff is one you meant to change. Read the help as a person in a terminal does. `bun run check` checks each entry in `examples` as the build does a guide's commands. Delete `scratch/docs-before` when you finish.

## How it ships

The pages ship in the `@metabase/cli` npm package, and the Metabase docs site copies them from the latest release into metabase/metabase's `docs/cli/`. That copy replaces the folder, so a fix made there is lost. A text change reaches the site only with a release, and a merge to `main` releases only when the `version` in `packages/cli/package.json` isn't on npm. When the change doesn't raise the version, say so in your report. Say so too when a page is new or renamed: the site's sidebar (`docs/util/data/nav.yml` in metabase/metabase) may need an entry, and the old URL a redirect.
