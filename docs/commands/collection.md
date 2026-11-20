---
title: "mb collection"
summary: "Manage Metabase collections."
---

# mb collection

Manage Metabase collections.

Agent skills:

- `mb skills get core`: collection ref forms and the transforms namespace

## mb collection list

List collections.

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

Body keys: `name` (required), `description`, `parent_id`, `authority_level`, `namespace`. Most collections use the default namespace (omit it). Pass `namespace: "transforms"` (or `--namespace transforms`) to create the kind of collection a transform's `collection_id` can point at — a regular collection is rejected there.

```sh
mb collection create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |
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

Patches only what you send: `--name`, `--description` or `--clear-description`, `--parent-id` (`root` moves it to the top level), `--archived true|false`, or a JSON body with any of `name`, `description`, `parent_id`, `authority_level`, `archived`. The server reads an absent `archived` as false, so when the patch leaves it out the CLI reads the collection first and sends its current state: an archived collection stays archived unless you pass `--archived false`. The server ignores `parent_id` in a request that trashes a collection, so moving and trashing a live collection together is sent as the move and then the trash. A collection enters the Trash only by being trashed, so a `--parent-id` that names the Trash (looked up with one more request whenever `--parent-id` is a collection id) is read as the trash alone with `--archived true` and refused otherwise. Setting `authority_level` needs admin and the Official Collections feature. Takes the integer id only; `root`, `trash`, and entity ids are refused.

```sh
mb collection update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Collection id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |
| `--name <value>` |  | New name. |
| `--description <value>` |  | New description. |
| `--clear-description` |  | Remove the description. |
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
