---
title: "mb collection"
summary: "Manage Metabase collections."
---

# mb collection

Manage Metabase collections.

Agent skills:

- `mb skills get core`: collection ref forms and the transforms namespace

## Collections

Collections are the folders that hold cards, dashboards, and other collections. [mb collection list](#mb-collection-list) includes the virtual root collection, "Our analytics", whose id is the string `"root"`, beside the numeric ids of the others.

## Moving, trashing, and restoring

[mb collection update](#mb-collection-update) with `--archived false` (or `"archived": false` in a body) restores an archived collection to its old location, or, with `--parent-id`, under that parent. `--parent-id` alone moves an archived collection and leaves it in the Trash.

The server ignores `parent_id` in a request that trashes a collection. So `--archived true` with `--parent-id` on a collection that is not in the Trash is sent as two requests: the move, with every other change, and then the trash. If the second one fails, the error says that the collection was moved but not trashed.

A collection enters the Trash only by being trashed. Whenever `--parent-id` is a collection id, the CLI looks up the Trash with one more request. A `--parent-id` that names the Trash is read as the trash alone with `--archived true`, and is refused otherwise.

## Official collections

Setting or clearing `authority_level` (`"official"`) needs an admin and the Official Collections feature (Pro and Enterprise). Without the feature, the server answers 402. Sending the value that the collection already has is no change, and passes on any instance.

## mb collection list

List collections.

`--filter archived` lists the archived collections and the Trash, and `--filter personal` only personal collections; neither includes the root collection. Every preset includes the Library collections that match it.

```sh
mb collection list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--filter <value>` | `all` | Filter preset: all\|archived\|personal. |
| `--namespace <value>` |  | List one namespace's collections: transforms\|snippets\|analytics\|shared-tenant-collection\|tenant-specific\|data-apps\|data-actions (omit for normal collections). |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema collection list --output`.

Examples:

```sh
mb collection list
mb collection list --json
mb collection list --filter archived --json
mb collection list --namespace transforms --json
```

## mb collection get

Get a collection by id, 21-char entity id, or "root"/"trash".

Any other reference is refused before any request. The root collection is virtual: its answer leaves out `archived`, `description`, `location` and `type` rather than sending them as `null`.

```sh
mb collection get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id, 21-char entity id, or one of: "root", "trash". |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema collection get --output`.

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

| Argument | Description |
| --- | --- |
| `<id>` | Collection id, 21-char entity id, or one of: "root", "trash". |

| Flag | Default | Description |
| --- | --- | --- |
| `-m, --models <value>` |  | Comma-separated model filter: card,dataset,metric,dashboard,snippet,collection,document,exploration,table,transform,measure,pulse,timeline,no_models. |
| `--archived` | `false` | Return archived items instead of unarchived. |
| `--pinned-state <value>` |  | Pinned filter: all\|is_pinned\|is_not_pinned. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema collection items --output`.

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

| Flag | Default | Description |
| --- | --- | --- |
| `--include-library` |  | Include the Library collections, which the tree leaves out by default. |

Shared flags: [format](README.md#format-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema collection tree --output`.

Examples:

```sh
mb collection tree
mb collection tree --json
mb collection tree --include-library
```

## mb collection create

Create a collection from a JSON spec.

Body keys: `name` (required), `description`, `parent_id` (omit it, or pass `null`, for the top level), `authority_level`, `namespace`. Most collections use the default namespace (omit it). Pass `namespace: "transforms"` (or `--namespace transforms`) to create the kind of collection a transform's `collection_id` can point at — a regular collection is rejected there.

```sh
mb collection create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--namespace <value>` |  | Collection namespace: transforms\|snippets\|analytics\|shared-tenant-collection\|tenant-specific\|data-apps\|data-actions (omit for a normal collection). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema collection create`. Output schema: `mb schema collection create --output`.

Examples:

```sh
cat collection.json | mb collection create
mb collection create --file collection.json
mb collection create --body '{"name":"My Collection","parent_id":4}'
mb collection create --body '{"name":"ETL"}' --namespace transforms
```

## mb collection update

Rename, describe, move, trash, or restore a collection by id (partial).

Patches only what you send, as flags or as a JSON body with any of `name`, `description` (`null` clears it), `parent_id` (`null` for the top level), `authority_level` and `archived`. The two forms are alternatives: a body beside a patch flag is refused (exit 2), and a body with no key, an unknown key, or a value of the wrong type fails validation (exit 1) before any request. The server reads an absent `archived` as false, so when the patch leaves it out the CLI reads the collection first and sends its current state: an archived collection stays archived unless you pass `--archived false`. Takes the integer id only; `root`, `trash`, and entity ids are refused.

```sh
mb collection update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--name <value>` |  | New name; a blank one is refused. |
| `--description <value>` |  | New description; a blank one is refused. |
| `--clear-description` |  | Remove the description; refused beside --description. |
| `--parent-id <value>` |  | Collection to move it under, or 'root' for the top level. |
| `--archived <value>` |  | true moves it to the trash, false restores it (default: leave as is). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema collection update`. Output schema: `mb schema collection update --output`.

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

Moves the collection to the Trash, where `collection list --filter archived` lists it; `mb collection update <id> --archived false` restores it. Takes the integer id only.

```sh
mb collection archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema collection archive --output`.

Examples:

```sh
mb collection archive 4
mb collection archive 4 --json
```
