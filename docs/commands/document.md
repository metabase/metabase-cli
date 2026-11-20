---
title: "mb document"
summary: "Manage Metabase documents."
---

# mb document

Manage Metabase documents.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get document`: author the ProseMirror document body

## A document is a TipTap JSON tree

A document is a rich-text page that mixes prose with embedded saved questions (`cardEmbed` nodes) and inline links to Metabase entities (`smartLink` nodes). Its body is a [TipTap](https://tiptap.dev/) (ProseMirror) JSON tree, stored with `content_type` `application/json+vnd.prose-mirror`. Documents need no premium token.

## Each block node needs an id

[mb document create](#mb-document-create) and [mb document update](#mb-document-update) refuse a body in which a `paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed` or `supportingText` node has no `_id`, a UUID. Without one, the document opens with a spurious "unsaved changes" prompt. Mint ids with [mb uuid](uuid.md). Other node types take no `_id`.

## mb document list

List documents.

Lists the documents you can see, except archived ones. The compact row leaves out the document body, which can be large; read it with `document get <id> --full`.

```sh
mb document list [flags]
```

Also takes the [list](README.md#list-flags) flags.

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

Also takes the [body](README.md#body-flags) flags.

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

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
cat patch.json | mb document update 1
mb document update 1 --file patch.json
mb document update 1 --body '{"name":"Renamed"}'
mb document update 1 --body '{"archived":false}'
```

## mb document copy

Copy a document, with the cards saved inside it, into a collection.

Duplicates the cards saved inside the document into the target collection, and points the copy's embeds at the duplicates. Without `--collection-id`, the copy lands in the root collection. An archived source isn't found.

```sh
mb document copy <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Document id. |
| `--name <value>` | Name for the copy (default: the source name). |
| `--collection-id <value>` | Collection to copy into (default: root). |
| `--collection-position <value>` | Pin the copy at this position in the collection. |

Needs `documentCopy` (v59+).

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

Examples:

```sh
mb document archive 1
mb document archive 1 --json
```
