---
name: core
description: "Foundations for building Metabase content as YAML files with the `mb` CLI: the loop (`mb metadata` to learn the warehouse, edit the representation YAML files in the git repo, `mb check` to validate, `mb save` to commit, push, and import), authentication and named profiles, the flag and `--json` output conventions, and which specialized skill to load for each kind of file. Load first for any `mb` task."
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# metabase-cli (core)

You build Metabase content by editing YAML files in a git repository: the Metabase representation format. Metabase imports the repo through git-sync. The `mb` CLI gives you exactly what the files can't:

```
mb metadata   read the warehouse: databases -> tables -> fields (types, FK targets, values)
mb check      validate the repo's YAML against the representation schemas (offline)
mb save       check, commit, push, and import into Metabase
```

Plus `mb auth` (the human's setup step) and `mb skills` (these guides). Nothing else: no create/update/delete verbs. **Content changes happen in the files.**

## Read metadata, edit files, check, then save

1. **Learn what exists.** Existing content (collections, cards, dashboards, ...) is already in the repo, so read the files. The warehouse is not in the repo, so ask `mb metadata` for it.
2. **Edit files.** Create or change YAML with your own file tools. Load `representations` first: it tells you where the spec and schemas are and how files reference each other.
3. **`mb check`** until it passes.
4. **`mb save -m "<what changed>"`**: it runs `check` again, then commits, pushes, and imports.

## `mb metadata` reads the warehouse one level per call

Every table and field row carries `ref`, the exact natural key the YAML writes.

```bash
mb metadata --json               # databases: id, name, engine
mb metadata 1 --json             # tables of database 1: id, schema, name, ref
mb metadata 1 42 --json          # fields of table 42: name, base_type, semantic_type,
                                 #   ref, fk_target (ref of the joined field), values
```

- **Copy `ref` verbatim** into queries and filters: `["Sample Database", "PUBLIC", "ORDERS", "TOTAL"]`. Never write numeric ids into YAML.
- **`fk_target`** is the ref of the field a foreign key points at. It's how you know a join or an implicit-join `source-field` will work.
- **`values`** holds the exact distinct values of a dropdown (`list`) field. Use them in `=` filters. `null` means the field has no stored value list; don't guess values.
- `semantic_type` tells you how to treat a column (`type/Category`, `type/Currency`, `type/CreationTimestamp`, `type/PK`, `type/FK`, ...).
- The ids (`1`, `42`) are only for drilling down. They never go in files.

## `mb check` validates the YAML offline

```bash
mb check            # the repo in the current directory
mb check ./repo     # another folder
```

It validates every importable YAML file against its entity schema. It lists only the failing files, each with `{file, model, errors: [{path, message}]}`, and exits 1 if any fail. `path` is a JSON pointer into the file. Look up the rule in `$DIR/spec/schemas/<entity>.yaml` (see `representations`). Passing `check` means the shape is valid, not that the names are right. The refs you copy from `mb metadata` cover that.

## `mb save` checks, commits, pushes, and imports

```bash
mb save -m "add weekly revenue dashboard" --json
```

In order: `check` (refuses on any failure), `git add -A`, commit (skipped when nothing changed), `git push origin <branch>`, then a Metabase git-sync import, waiting until it finishes. It exits non-zero if the import errors or conflicts, and the message says why.

- **The current branch must be the branch Metabase syncs from.** Otherwise save refuses and names both branches. Switch branches. Don't reconfigure Metabase.
- `git add -A` stages everything in the repo. Keep scratch files outside it.
- An import `conflict` means Metabase has unsynced edits made in the UI. Stop and tell the user. Don't force anything.

## The human logs in; the agent picks a profile

`metadata` and `save` talk to Metabase, and `check` does not. **The agent does not log in for the user.** The human creates a named profile once (`mb auth login`), or sets `MB_URL` and `MB_API_KEY`.

```bash
mb auth list --json      # every profile: {profile, url, authenticated, status}
mb auth status --json    # the default profile
```

- One profile → use it. Several → ask which one (`AskUserQuestion`). None → ask the user to run `mb auth login` and tell you the name.
- Pass `--profile <name>` after the full verb: `mb metadata 1 --profile prod`, not `mb --profile prod metadata`.
- `save` needs an admin profile on a server with git-sync (remote sync) configured.

## `--json` output is one envelope to parse

- `--json` prints one JSON envelope (auto when piped). Parse it with `jq`; never scrape text.
- List output is `{returned, offset, total, has_more, next_offset, truncated?, data}`. When `has_more` is true, pass `next_offset` back as `--offset`. `--limit <n>` caps rows.
- `--fields a,b` projects fields of each `data[]` row, and `--full` returns every field. Output is capped at `--max-bytes` (default 24576). Narrow with `--fields` before raising the cap.
- `mb <command> --help` shows flags and examples. `--help --json` shows the output schema.

## Load the matching skill before writing each kind of file

Run `mb skills get <name>`:

- **`representations`**: the format itself. Where the spec and schemas live, folder layout, entity_ids, refs, `collection_id`. Load first.
- **`mbql`**: query bodies (`dataset_query` of a card, `source.query` of a transform, `definition` of a segment/measure).
- **`native-sql`**: native SQL queries with template tags, field filters, snippets.
- **`visualization`**: a card's `display` and `visualization_settings`.
- **`dashboard`**: dashboard YAML: grid layout, dashcards, filters, click behavior, tabs.
- **`transform`**: transform, transform-tag, and transform-job YAML.
- **`document`**: document YAML and the cards embedded in it.
- **`notification`**: notification channels (email/http) in YAML.

## Never do these

- Don't call the Metabase API with `curl` to create or change content. Files plus `mb save` are the only write path.
- Don't paste credentials in chat. The human stores them with `mb auth login`.
- Don't run `mb save` to "see what happens". Run `mb check` until it's clean first.
