---
title: "mb collection"
summary: "Manage Metabase collections."
---

# mb collection

Manage Metabase collections.

Every command on this page takes the [profile](README.md#profile-flags) and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get core`: collection ref forms and the transforms namespace

## Collections are folders

Collections are the folders that hold cards, dashboards, and other collections. [mb collection list](#mb-collection-list) includes the virtual root collection, **Our analytics**, whose id is the string `"root"`, beside the numeric ids of the others.

## Restore a collection with `--archived false`

[mb collection update](#mb-collection-update) with `--archived false` (or `"archived": false` in a body) restores an archived collection to its old location, or, with `--parent-id`, under that parent. `--parent-id` alone moves an archived collection and leaves it in the trash.

`--archived true` with `--parent-id` moves the collection and then trashes it, in two requests, since the server ignores `parent_id` when it trashes. If the second request fails, the error says that the collection moved but isn't in the trash.

A `--parent-id` that names the trash is refused, except with `--archived true`, where it only trashes the collection.

## Official collections need an admin and a Pro or Enterprise plan

Setting or clearing `authority_level` (`"official"`) needs an admin and the Official Collections feature; without the feature, the server answers 402. Sending the value the collection already has changes nothing, and works on any instance.

## mb collection list

List collections.

`--filter archived` lists the archived collections and the trash, and `--filter personal` only personal collections; neither includes the root collection. Every preset includes the Library collections that match it.

```sh
mb collection list [flags]
```

| Flag | Description |
| --- | --- |
| `--filter <value>` | Filter preset: all\|archived\|personal. Default: `all`. |
| `--namespace <value>` | List one namespace's collections: transforms\|snippets\|analytics\|shared-tenant-collection\|tenant-specific\|data-apps\|data-actions (omit for normal collections). |

Also takes the [output](README.md#output-flags) and [list](README.md#list-flags) flags.

Examples:

```sh
mb collection list
mb collection list --json
mb collection list --filter archived --json
mb collection list --namespace transforms --json
```

## mb collection get

Get a collection by id, 21-char entity id, or "root"/"trash".

Any other reference is refused before any request. The root collection is virtual: its response leaves out `archived`, `description`, `location` and `type` rather than sending them as `null`.

```sh
mb collection get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id, 21-char entity id, or one of: "root", "trash". |

Also takes the [output](README.md#output-flags) flags.

Examples:

```sh
mb collection get 4
mb collection get root --json
mb collection get trash --json
mb collection get voo1If9y8Sld0lXej6xl0 --json
```

## mb collection items

List items inside a collection.

Takes the same references as `collection get`; the items under `root` carry `collection_id: null`. The server pages the items, so the CLI reads only as many pages as the output cap can show, then reports `has_more` / `next_offset` to continue.

```sh
mb collection items <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Collection id, 21-char entity id, or one of: "root", "trash". |
| `-m, --models <value>` | Comma-separated model filter: card,dataset,metric,dashboard,snippet,collection,document,exploration,table,transform,measure,pulse,timeline,no_models. |
| `--archived` | Return archived items instead of unarchived. |
| `--pinned-state <value>` | Pinned filter: all\|is_pinned\|is_not_pinned. |

Also takes the [output](README.md#output-flags) and [list](README.md#list-flags) flags.

Examples:

```sh
mb collection items 4
mb collection items root --json
mb collection items trash --json
mb collection items 4 --models card,dashboard --json
mb collection items 4 --pinned-state is_pinned --json
```

## mb collection tree

Fetch the collection hierarchy as a nested tree (JSON only).

The tree is the server's JSON as is, so it takes no `--full`, `--fields` or `--max-bytes`. It leaves out the Library collections that `collection list` includes, unless `--include-library` is given.

```sh
mb collection tree [flags]
```

| Flag | Description |
| --- | --- |
| `--include-library` | Include the Library collections, which the tree leaves out by default. |

Also takes the [format](README.md#format-flags) flags.

Examples:

```sh
mb collection tree
mb collection tree --json
mb collection tree --include-library
```

## mb collection create

Create a collection from a JSON spec.

Body keys: `name` (required), `description`, `parent_id` (omit it, or pass `null`, for the top level), `authority_level` and `namespace`. Leave out `namespace` for a regular collection. A transform's `collection_id` must point at a collection made with `namespace: "transforms"` (or `--namespace transforms`).

```sh
mb collection create [flags]
```

| Flag | Description |
| --- | --- |
| `--namespace <value>` | Collection namespace: transforms\|snippets\|analytics\|shared-tenant-collection\|tenant-specific\|data-apps\|data-actions (omit for a normal collection). |

Also takes the [output](README.md#output-flags) and [body](README.md#body-flags) flags.

Examples:

```sh
cat collection.json | mb collection create
mb collection create --file collection.json
mb collection create --body '{"name":"My Collection","parent_id":4}'
mb collection create --body '{"name":"ETL"}' --namespace transforms
```

## mb collection update

Rename, describe, move, trash, or restore a collection by id (partial).

Changes only what you send, as flags or as a JSON body with any of `name`, `description` (`null` clears it), `parent_id` (`null` for the top level), `authority_level` and `archived`. Use flags or a body, not both (exit 2). An archived collection stays archived unless you pass `--archived false`. Takes the integer ID only; `root`, `trash` and entity IDs are refused.

```sh
mb collection update <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Collection id. |
| `--name <value>` | New name; a blank one is refused. |
| `--description <value>` | New description; a blank one is refused. |
| `--clear-description` | Remove the description. Can't be used with `--description`. |
| `--parent-id <value>` | Collection to move it under, or 'root' for the top level. |
| `--archived <value>` | true moves it to the trash, false restores it (default: leave as is). |

Also takes the [output](README.md#output-flags) and [body](README.md#body-flags) flags.

Examples:

```sh
mb collection update 4 --name "Marketing"
mb collection update 4 --description "Campaign reporting" --parent-id 2
mb collection update 4 --parent-id root
mb collection update 4 --clear-description
mb collection update 4 --archived false
mb collection update 4 --body '{"parent_id":null,"authority_level":"official"}'
mb collection update 4 --file patch.json --json
```

## mb collection archive

Archive (soft-delete) a collection by id.

Moves the collection to the trash, where `collection list --filter archived` lists it; `mb collection update <id> --archived false` restores it. Takes the integer ID only.

```sh
mb collection archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id. |

Also takes the [output](README.md#output-flags) flags.

Examples:

```sh
mb collection archive 4
mb collection archive 4 --json
```
