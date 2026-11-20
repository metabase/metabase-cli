---
title: "mb document"
summary: "Manage Metabase documents."
---

# mb document

Manage Metabase documents.

Agent skills:

- `mb skills get document`: author the ProseMirror document body

## Documents

A document is a rich-text page that mixes prose with embedded saved questions (`cardEmbed` nodes) and inline links to Metabase entities (`smartLink` nodes). Its body is a [TipTap](https://tiptap.dev/) (ProseMirror) JSON tree, stored with `content_type` `application/json+vnd.prose-mirror`. Documents are a baseline open-source feature: they need no premium token.

## Node ids

For a document to open clean, with no spurious "unsaved changes" prompt, each `paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed` and `supportingText` node carries its own `_id`, a UUID. [mb document create](#mb-document-create) and [mb document update](#mb-document-update) refuse a body in which one of these nodes has none. Mint ids with [mb uuid](uuid.md). Other node types take no `_id`.

## mb document list

List documents.

Lists the documents you can see, except archived ones. The compact row leaves out the document body, which can be large; read it with `document get <id> --full`.

```sh
mb document list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema document list --output`.

Examples:

```sh
mb document list
mb document list --json
```

## mb document get

Get a document by id.

```sh
mb document get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Document id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema document get --output`.

Examples:

```sh
mb document get 1
mb document get 1 --full --json
```

## mb document create

Create a document.

Body keys: `name` (required), `document` (required, the TipTap `doc` tree), `collection_id` (`null` files it under **Our analytics**) and `collection_position`. A `cardEmbed` node can create a card with the document: give it a negative ID, and put the card's definition in a top-level `cards` map under that ID.

```sh
mb document create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema document create`. Output schema: `mb schema document create --output`.

Examples:

```sh
cat doc.json | mb document create
mb document create --file doc.json
mb document create --body '{"name":"Notes","document":{"type":"doc","content":[]}}'
```

## mb document update

Update a document by id.

The body takes any of the `create` keys, plus `archived`, and changes only the keys you send. A `document` key replaces the whole body.

```sh
mb document update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Document id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema document update`. Output schema: `mb schema document update --output`.

Examples:

```sh
cat patch.json | mb document update 1
mb document update 1 --file patch.json
mb document update 1 --body '{"name":"Renamed"}'
mb document update 1 --body '{"archived":false}'
```

## mb document copy

Copy a document, with the cards saved inside it, into a collection.

The copy duplicates the cards saved inside the document into the target collection and carries the source body with their embeds pointing at the duplicates. Without --collection-id the copy lands in the root collection. An archived source is not found.

```sh
mb document copy <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Document id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--name <value>` |  | Name for the copy (default: the source name). |
| `--collection-id <value>` |  | Collection to copy into (default: root). |
| `--collection-position <value>` |  | Pin the copy at this position in the collection. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `documentCopy` (v59+).

Output schema: `mb schema document copy --output`.

Examples:

```sh
mb document copy 1
mb document copy 1 --collection-id 4 --name "Notes (copy)" --json
```

## mb document archive

Archive (soft-delete) a document by id.

To restore it, run `mb document update <id> --body '{"archived":false}'`.

```sh
mb document archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Document id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema document archive --output`.

Examples:

```sh
mb document archive 1
mb document archive 1 --json
```
