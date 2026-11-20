---
title: "mb dependency"
summary: "Trace what Metabase content depends on and what depends on it."
---

# mb dependency

Trace what Metabase content depends on and what depends on it.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Every command on this page needs `dependencyGraph` (token dependencies).

Metabase records an edge from each card, dashboard, document, snippet, transform, sandbox, segment, measure or action to what it reads (a table, a card, a snippet, a transform's output), and analyzes each dependent's query for errors it traces back to what it reads. From Metabase v60, a background job recomputes the graph shortly after content changes, so a just-saved query can take a few seconds to appear.

## What each row holds

Every row is `{ id, type, data }`, plus `dependents_count` where the command reports it: a map from usage kind (`question`, `model`, `metric`, `dashboard`, `document`, `transform`, …) to how many entities depend directly on the row, or `null` when nothing does. `data` names and places the entity:

| Entity                    | `data` carries                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table                     | `name`, `display_name`, `db_id`, `schema` and `db` (`{ id, name }`)                                                                                |
| Card                      | `name`, `type` (`question`, `model` or `metric`), `database_id`, `view_count`, `collection`, and the `dashboard` or `document` it lives in, if any |
| Dashboard, document       | `view_count` and `collection`                                                                                                                      |
| Snippet                   | `collection`                                                                                                                                       |
| Action                    | `type` (`query` or `implicit`) and `collection`                                                                                                    |
| Segment, measure, sandbox | `table` (`{ id, name, display_name }`)                                                                                                             |
| Transform                 | `name` and `description`, with `table` always `null`                                                                                               |

`--full` adds the heavier fields: a table's `fields`, a card's `result_metadata`, creators and last-edit info.

## An entity's location

An entity's location is the dashboard, document or collection that holds a card, a table's database, a segment's or measure's table, or the collection of a snippet, dashboard, document or action. `--query` matches it as well as the name, `--sort-column location` sorts by it, and the text table shows it. A sandbox has none, so `unreferenced` and `breaking` sort it by id.

A transform's row carries no collection. `unreferenced` and `breaking`, which match and sort on the server, use its collection's name (`Transforms` at the root); `dependents`, `broken` and the text table give it no location.

## Archived and dropped content

From Metabase v63, `graph` includes archived upstream entities; older servers leave them out. On every server, `dependents`, `broken` and `unreferenced` leave out archived cards, dashboards, documents, snippets, actions, segments and measures.

From v63, `unreferenced` and `breaking` also keep dropped and hidden tables, and `breaking` keeps archived sources, so they report a dropped table or an archived card that broke its dependents. Older servers leave these out, and the CLI has no flag to bring them back.

## mb dependency graph

Show everything an entity depends on, directly or transitively.

`nodes` holds the entity and every table, card, snippet, transform or other entity it reads from, each with its `dependents_count` by kind; `edges` run from a dependent to what it depends on. `--full` adds the heavier fields to each node (a table's `fields`, a card's `result_metadata`).

```sh
mb dependency graph <type> <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). A `measure` needs v59+, an `action` v65+. |
| `<id>` | Entity id. |

Examples:

```sh
mb dependency graph card 1
mb dependency graph table 12 --json
mb dependency graph transform 3 --fields edges
```

## mb dependency dependents

List the entities that depend directly on an entity.

Each row carries its own `dependents_count` by kind, so you can follow a chain one hop at a time. `--broken` keeps only the dependents whose query analysis failed, for any cause, and each row's `dependents_count` then counts only its broken dependents. The server sorts and filters; the CLI applies the window.

```sh
mb dependency dependents <type> <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). A `measure` needs v59+, an `action` v65+. |
| `<id>` | Entity id. |
| `--dependent-types <value>` | Comma-separated entity kinds to keep: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--dependent-card-types <value>` | Comma-separated card kinds to keep (narrows card dependents only): question,model,metric. |
| `--sort-column <value>` | Sort by: name\|location\|view-count (default: name). |
| `--include-personal-collections` | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` | Sort direction: asc\|desc (default: asc). |
| `--query <value>` | Keep entities whose name or location contains this text (case-insensitive); must not be blank. |
| `--broken` | Only the dependents whose query analysis failed, whatever the cause. |

Also takes the [list](README.md#list-flags) flags.

Also needs `dependencyItemListings` (v59+, token dependencies).

Examples:

```sh
mb dependency dependents table 12
mb dependency dependents card 1 --dependent-types card,dashboard --json
mb dependency dependents table 12 --broken --json
mb dependency dependents card 1 --sort-column view-count --sort-direction desc
```

## mb dependency broken

List the dependents whose queries an entity has broken.

Lists the entities whose query analysis traced a validation error (a missing column, a syntax error) back to this entity, directly or through others. Only a table, a card or (from Metabase v60) a transform is traced as a cause, so any other `<type>` lists nothing. Rows carry no `dependents_count`. For the direct dependents whose analysis failed for any cause, use `mb dependency dependents <type> <id> --broken`.

```sh
mb dependency broken <type> <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). A `measure` needs v59+, an `action` v65+. |
| `<id>` | Entity id. |
| `--dependent-types <value>` | Comma-separated entity kinds to keep: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--dependent-card-types <value>` | Comma-separated card kinds to keep (narrows card dependents only): question,model,metric. |
| `--sort-column <value>` | Sort by: name\|location\|view-count (default: name). |
| `--include-personal-collections` | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` | Sort direction: asc\|desc (default: asc). |

Also takes the [list](README.md#list-flags) flags.

Also needs `dependencyItemListings` (v59+, token dependencies).

Examples:

```sh
mb dependency broken table 12
mb dependency broken card 1 --dependent-types card --json
```

## mb dependency unreferenced

List the entities no readable, unarchived content depends on, across the instance.

Only dependents you can read that aren't archived count, so an entity used only by archived content, or by content in collections you can't read, is listed. Lists every entity kind unless `--types` narrows it; `--query` leaves out sandboxes, which have no name or location to match. The server pages the answer: `total` is its count, and `--limit` and `--offset` size the request.

```sh
mb dependency unreferenced [flags]
```

| Flag | Description |
| --- | --- |
| `--types <value>` | Comma-separated entity kinds to list: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--card-types <value>` | Comma-separated card kinds to list (narrows cards only): question,model,metric. |
| `--query <value>` | Keep entities whose name or location contains this text (case-insensitive); must not be blank. |
| `--sort-column <value>` | Sort by: name\|location\|dependents-with-errors\|dependents-errors (default: name). |
| `--include-personal-collections` | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` | Sort direction: asc\|desc (default: asc). |

Also takes the [list](README.md#list-flags) flags.

Also needs `dependencyItemListings` (v59+, token dependencies).

Examples:

```sh
mb dependency unreferenced
mb dependency unreferenced --types card --card-types model,metric --json
mb dependency unreferenced --query orders --sort-column location --json
```

## mb dependency breaking

List the entities whose dependents carry query errors, across the whole instance.

Each row is a source of breakage with its `dependents_errors`: the validation errors query analysis traced back to it, each with the dependent it was found in (`analyzed_entity_type`, `analyzed_entity_id`) and its `error_type` (`missing-column`, `syntax-error`, …). Lists cards and tables unless `--types` says otherwise; only a table, a card or (from Metabase v60) a transform can be a source. The server pages the answer: `total` is its count, and `--limit` and `--offset` size the request.

```sh
mb dependency breaking [flags]
```

| Flag | Description |
| --- | --- |
| `--types <value>` | Comma-separated entity kinds to list: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--card-types <value>` | Comma-separated card kinds to list (narrows cards only): question,model,metric. |
| `--query <value>` | Keep entities whose name or location contains this text (case-insensitive); must not be blank. |
| `--sort-column <value>` | Sort by: name\|location\|dependents-with-errors\|dependents-errors (default: name). |
| `--include-personal-collections` | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` | Sort direction: asc\|desc (default: asc). |

Also takes the [list](README.md#list-flags) flags.

Also needs `dependencyItemListings` (v59+, token dependencies).

Examples:

```sh
mb dependency breaking
mb dependency breaking --types table --json
mb dependency breaking --sort-column dependents-errors --sort-direction desc --json
```
