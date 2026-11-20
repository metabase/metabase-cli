---
title: "mb dependency"
summary: "Trace what Metabase content depends on and what depends on it."
---

# mb dependency

Trace what Metabase content depends on and what depends on it.

## mb dependency graph

Show everything an entity depends on, directly or transitively.

`nodes` holds the entity itself plus every table, card, snippet, transform or other entity it reads from, each with its `dependents_count` by kind; `edges` run from a dependent to what it depends on. Pass `--full` for the heavier hydrations on each node (a table's `fields`, a card's `result_metadata`).

```sh
mb dependency graph <type> <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). |
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
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). |
| `<id>` | Entity id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--dependent-types <value>` |  | Comma-separated entity kinds to keep: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--dependent-card-types <value>` |  | Comma-separated card kinds to keep (narrows card dependents only): question,model,metric. |
| `--sort-column <value>` |  | Sort by: name\|location\|view-count (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections. |
| `--sort-direction <value>` |  | Sort direction: asc\|desc (default: asc). |
| `--query <value>` |  | Keep entities whose name or location contains this text (case-insensitive). |
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

An entity is listed when Metabase's query analysis traced a validation error in it (a missing column, a syntax error) back to this entity, whether it reads the entity directly or through others. Only a table, a card or a transform is ever traced as the cause, so any other `<type>` lists nothing. Rows carry no `dependents_count`. `mb dependency dependents <type> <id> --broken` answers a different set: the direct dependents whose analysis failed for any cause.

```sh
mb dependency broken <type> <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<type>` | Entity kind (table \| card \| snippet \| transform \| dashboard \| document \| sandbox \| segment \| measure \| action). |
| `<id>` | Entity id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--dependent-types <value>` |  | Comma-separated entity kinds to keep: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--dependent-card-types <value>` |  | Comma-separated card kinds to keep (narrows card dependents only): question,model,metric. |
| `--sort-column <value>` |  | Sort by: name\|location\|view-count (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections. |
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
| `--query <value>` |  | Keep entities whose name or location contains this text (case-insensitive). |
| `--sort-column <value>` |  | Sort by: name\|location\|dependents-with-errors\|dependents-errors (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections. |
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

Each row is a source of breakage with `dependents_errors`, the validation errors query analysis traced back to it, each naming the dependent it was found in. Cards and tables are listed unless `--types` says otherwise; only a table, a card or a transform can be a source, so any other kind lists nothing. The server pages the answer, so `total` is its count and `--limit` / `--offset` size the request.

```sh
mb dependency breaking [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--types <value>` |  | Comma-separated entity kinds to list: table,card,snippet,transform,dashboard,document,sandbox,segment,measure,action. |
| `--card-types <value>` |  | Comma-separated card kinds to list (narrows cards only): question,model,metric. |
| `--query <value>` |  | Keep entities whose name or location contains this text (case-insensitive). |
| `--sort-column <value>` |  | Sort by: name\|location\|dependents-with-errors\|dependents-errors (default: name). |
| `--include-personal-collections` |  | Also list content in personal collections. |
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
