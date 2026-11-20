---
title: "mb dependency"
summary: "Trace what Metabase content depends on and what depends on it."
---

# mb dependency

Trace what Metabase content depends on and what depends on it.

Metabase records an edge from every card, dashboard, document, snippet, transform, sandbox, segment, measure or action to what it reads (a table, a card, a snippet, a transform's output), and analyses each dependent's query for errors traced back to what it reads. From Metabase v60 a background job recomputes the graph shortly after content changes, so a freshly saved query can take a few seconds to appear.

## Rows

Every row is `{ id, type, data }` plus, where the command reports it, `dependents_count`: a map from usage kind (`question`, `model`, `metric`, `dashboard`, `document`, `transform`, …) to how many entities depend on the row directly, or `null` when nothing does.

`data` names and places the entity by kind:

- A table carries `name`, `display_name`, `db_id`, `schema` and its `db` (`{ id, name }`).
- A card carries `name`, `type` (`question`, `model` or `metric`), `database_id`, `view_count` and its `collection`, plus the `dashboard` or `document` it lives inside, when it does.
- A dashboard or document carries its `view_count` and `collection`; a snippet its `collection`; an action its `type` (`query` or `implicit`) and `collection`.
- A segment, measure or sandbox carries its `table` (`{ id, name, display_name }`).
- A transform carries its `name` and `description` only, with `table` always `null`.

The compact projection keeps those; `--full` adds the heavier hydrations: a table's `fields`, a card's `result_metadata`, creators, last-edit info.

## Locations

An entity's location is what `--query` matches besides its name, what `--sort-column location` orders by, and what the text table shows: the dashboard, document or collection holding a card, a table's database, a segment's or measure's table, and the collection of a snippet, dashboard, document or action. A sandbox has none; `unreferenced` and `breaking` sort it by its id.

A transform's row carries no collection. `unreferenced` and `breaking`, which match and sort on the server, use its collection's name (`Transforms` for one at the root), while `dependents`, `broken` and the text table give it no location.

## Archived and dropped content

From Metabase v63 `graph` includes archived upstream entities; older servers leave them out. `dependents`, `broken` and `unreferenced` leave archived cards, dashboards, documents, snippets, actions, segments and measures out on every server.

From v63 `unreferenced` and `breaking` also keep dropped and hidden tables, and `breaking` keeps archived sources, so a dropped table or an archived card that broke its dependents is reported. Older servers leave all of these out, and only an `archived` parameter the newer ones dropped would bring them back, so the CLI does not offer it.

## mb dependency graph

Show everything an entity depends on, directly or transitively.

`nodes` holds the entity itself plus every table, card, snippet, transform or other entity it reads from, each with its `dependents_count` by kind; `edges` run from a dependent to what it depends on. Pass `--full` for the heavier hydrations on each node (a table's `fields`, a card's `result_metadata`).

```sh
mb dependency graph <type> <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). A `measure` needs v59+, an `action` v65+. |
| `<id>` | Entity id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dependencyGraph` (token dependencies).

Output schema: `mb schema dependency graph --output`.

Examples:

```sh
mb dependency graph card 1
mb dependency graph table 12 --json
mb dependency graph transform 3 --fields edges
```

## mb dependency dependents

List the entities that depend directly on an entity.

Each row is a dependent with its own `dependents_count` by kind, so a chain can be followed one hop at a time. `--broken` keeps only the dependents whose query analysis failed, whatever the cause, and each row's `dependents_count` then counts only its broken dependents. The server sorts and filters; the window is applied here.

```sh
mb dependency dependents <type> <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). A `measure` needs v59+, an `action` v65+. |
| `<id>` | Entity id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--dependent-types <value>` |  | Comma-separated entity kinds to keep: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--dependent-card-types <value>` |  | Comma-separated card kinds to keep (narrows card dependents only): question,model,metric. |
| `--sort-column <value>` |  | Sort by: name\|location\|view-count (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` |  | Sort direction: asc\|desc (default: asc). |
| `--query <value>` |  | Keep entities whose name or location contains this text (case-insensitive); must not be blank. |
| `--broken` |  | Only the dependents whose query analysis failed, whatever the cause. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dependencyItemListings` (v59+, token dependencies).

Output schema: `mb schema dependency dependents --output`.

Examples:

```sh
mb dependency dependents table 12
mb dependency dependents card 1 --dependent-types card,dashboard --json
mb dependency dependents table 12 --broken --json
mb dependency dependents card 1 --sort-column view-count --sort-direction desc
```

## mb dependency broken

List the dependents whose queries an entity has broken.

An entity is listed when Metabase's query analysis traced a validation error in it (a missing column, a syntax error) back to this entity, whether it reads the entity directly or through others. Only a table, a card or (from Metabase v60) a transform is ever traced as the cause, so any other `<type>` lists nothing. Rows carry no `dependents_count`. `mb dependency dependents <type> <id> --broken` answers a different set: the direct dependents whose analysis failed for any cause.

```sh
mb dependency broken <type> <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). A `measure` needs v59+, an `action` v65+. |
| `<id>` | Entity id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--dependent-types <value>` |  | Comma-separated entity kinds to keep: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--dependent-card-types <value>` |  | Comma-separated card kinds to keep (narrows card dependents only): question,model,metric. |
| `--sort-column <value>` |  | Sort by: name\|location\|view-count (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` |  | Sort direction: asc\|desc (default: asc). |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dependencyItemListings` (v59+, token dependencies).

Output schema: `mb schema dependency broken --output`.

Examples:

```sh
mb dependency broken table 12
mb dependency broken card 1 --dependent-types card --json
```

## mb dependency unreferenced

List the entities no readable, unarchived content depends on, across the instance.

Only a dependent the caller can read and that is not archived counts, so an entity used only by archived content, or by content in collections the caller cannot read, is listed. Every entity kind is listed unless `--types` narrows it; a `--query` leaves sandboxes out, since they have no name or location to match. The server pages the answer, so `total` is its count and `--limit` / `--offset` size the request.

```sh
mb dependency unreferenced [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--types <value>` |  | Comma-separated entity kinds to list: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--card-types <value>` |  | Comma-separated card kinds to list (narrows cards only): question,model,metric. |
| `--query <value>` |  | Keep entities whose name or location contains this text (case-insensitive); must not be blank. |
| `--sort-column <value>` |  | Sort by: name\|location\|dependents-with-errors\|dependents-errors (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` |  | Sort direction: asc\|desc (default: asc). |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dependencyItemListings` (v59+, token dependencies).

Output schema: `mb schema dependency unreferenced --output`.

Examples:

```sh
mb dependency unreferenced
mb dependency unreferenced --types card --card-types model,metric --json
mb dependency unreferenced --query orders --sort-column location --json
```

## mb dependency breaking

List the entities whose dependents carry query errors, across the whole instance.

Each row is a source of breakage with `dependents_errors`, the validation errors query analysis traced back to it, each naming the dependent it was found in (`analyzed_entity_type`, `analyzed_entity_id`) and its `error_type` (`missing-column`, `syntax-error`, …). Cards and tables are listed unless `--types` says otherwise; only a table, a card or (from Metabase v60) a transform can be a source, so any other kind lists nothing. The server pages the answer, so `total` is its count and `--limit` / `--offset` size the request.

```sh
mb dependency breaking [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--types <value>` |  | Comma-separated entity kinds to list: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--card-types <value>` |  | Comma-separated card kinds to list (narrows cards only): question,model,metric. |
| `--query <value>` |  | Keep entities whose name or location contains this text (case-insensitive); must not be blank. |
| `--sort-column <value>` |  | Sort by: name\|location\|dependents-with-errors\|dependents-errors (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections, which is left out by default. |
| `--sort-direction <value>` |  | Sort direction: asc\|desc (default: asc). |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dependencyItemListings` (v59+, token dependencies).

Output schema: `mb schema dependency breaking --output`.

Examples:

```sh
mb dependency breaking
mb dependency breaking --types table --json
mb dependency breaking --sort-column dependents-errors --sort-direction desc --json
```
