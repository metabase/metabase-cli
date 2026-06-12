---
name: document
description: Author and edit Metabase documents via `mb` — the TipTap (ProseMirror) JSON body shape, the node-type inventory (paragraphs, headings, lists, plus the Metabase-custom `cardEmbed` / `smartLink` / `flexContainer` / `resizeNode`), the per-node-type `_id` requirement, embedding existing or brand-new cards, and the list/get/create/update/archive verbs. Load when the user touches documents — "create a document", "add a card to a document", "edit a document", "list documents", or anything `mb document …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Documents

A **document** is a Metabase rich-text page (a "report" / notebook) that mixes prose with embedded saved questions and links to other Metabase entities. The body is a **TipTap** JSON tree (TipTap is the editor; the wire format is ProseMirror JSON, and the server stores it under `content_type: "application/json+vnd.prose-mirror"`).

This skill covers authoring the body and driving the verbs. General flag conventions, body-input precedence, and output flags live in the `core` skill (`mb skills get core`).

## Command surface

```bash
mb document list --profile <name> --json                 # non-archived docs visible to you
mb document get <id> --profile <name> --full --json      # one doc incl. its TipTap body
mb document create --file doc.json --profile <name> --json
mb document update <id> --file patch.json --profile <name> --json   # PATCH semantics
mb document archive <id> --profile <name> --json         # soft-delete (PUT archived:true)
```

- `list` returns the standard envelope (`{data, returned, total}`). The compact item is `{id, name, collection_id, archived, creator_id, can_write}` — it does **not** include the (potentially huge) `document` body. Pull the body with `get --full`.
- `archive` is the only delete, mirroring `card` / `dashboard`. **Unarchive** with `mb document update <id> --body '{"archived":false}'`.
- `update` is PATCH — send only the keys you want to change (`name`, `document`, `collection_id`, `collection_position`, `archived`). Replacing `document` replaces the **whole** body; there is no partial-node patch.

## Node ids (`_id`)

The editor anchors only these node types with an `_id` (a UUID): `paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed`, `supportingText`. **`create`/`update` require a non-empty `_id` on every node of those types** and reject a body missing any; other node types (`doc`, `text`, `listItem`, `resizeNode`, `flexContainer`, …) don't take an `_id` and are left alone. Mint the ids with the bundled `uuid` command — one per id-bearing node:

```bash
mb uuid --count 5 --json     # → ["…", …]   one UUID per id-bearing node
```

Set each as that node's `attrs._id`. Without them the editor backfills ids when the document opens, which makes a freshly-saved document show a spurious "unsaved changes" prompt.

## Body shape (create / update)

The create body is `{name, document, collection_id?, collection_position?}`. `name` and `document` are required on create; everything is optional on update.

`document` is the TipTap tree — a root `doc` node whose `content` is an array of block nodes (replace each `<uuid-N>` with an `mb uuid` value):

```json
{
  "name": "Weekly report",
  "collection_id": 12,
  "document": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 1, "_id": "<uuid-1>" },
        "content": [{ "type": "text", "text": "Weekly report" }]
      },
      {
        "type": "paragraph",
        "attrs": { "_id": "<uuid-2>" },
        "content": [{ "type": "text", "text": "Orders trended up this week." }]
      }
    ]
  }
}
```

`collection_id: null` (or omitted) files the document in "Our analytics" (the root). `collection_id` accepts any normal analytics collection id (unlike transforms, documents are not namespace-restricted).

## Node inventory

Every node is `{ "type": string, "attrs"?: object, "content"?: [nodes], "text"?: string, "marks"?: [marks] }`. The id-bearing types listed above carry `attrs._id`; the rest don't.

**Standard text nodes** (TipTap StarterKit):

- `doc` — the root; `content` holds block nodes.
- `paragraph` — `content` is inline nodes (usually `text`). An empty paragraph (`{ "type": "paragraph", "attrs": { "_id": "<uuid>" } }`) is a blank line.
- `text` — a leaf with `text` and optional `marks` (no `_id`).
- `heading` — `attrs.level` 1–6.
- `bulletList` / `orderedList` — `content` is `listItem` nodes (no `_id`); each `listItem` wraps `paragraph`(s).
- `blockquote`, `codeBlock`, `horizontalRule`, `hardBreak`, `image`.

**Marks** on `text` (the `marks` array): `bold`, `italic`, `strike`, `code`, plus `link` (`attrs.href`). Example: `{ "type": "text", "text": "important", "marks": [{ "type": "bold" }] }`.

**Metabase-custom nodes** (the reason a document is more than a wiki page):

- **`cardEmbed`** — an embedded saved question. Block, atomic, id-bearing. `attrs: { "id": <card-id>, "name": <string|null>, "_id": "<uuid>" }`. `name` overrides the displayed title (`null` = use the card's own name). Card embeds are commonly wrapped in a `resizeNode` to give them a fixed height.
- **`resizeNode`** — wraps a single `cardEmbed` or `flexContainer` to make it resizable (no `_id`). `attrs: { "height": <px>, "minHeight": <px> }`, `content` is exactly one `cardEmbed`/`flexContainer`.
- **`flexContainer`** — a horizontal row of 1–3 `cardEmbed` / `supportingText` cells side by side (no `_id`). `attrs.columnWidths` is an array of width percentages.
- **`supportingText`** — a text column that sits next to a card inside a `flexContainer` (id-bearing); `content` is the usual block nodes (`paragraph`, `heading`, lists, …).
- **`smartLink`** — an inline reference to a Metabase entity (renders as a live chip). Inline, atomic, no `_id`. `attrs: { "entityId": <id>, "model": <model>, "label": <string|null>, "href": <relative-path> }`. `model` ∈ `card`, `dataset`, `metric`, `dashboard`, `collection`, `table`, `database`, `document`, `transform`, `segment`, `measure`, `user`, `action`, `indexed-entity`.
- **`metabot`** — an inline Metabot prompt block.

## Embedding an existing card

A document embedding an existing card (id 114) under a heading (only the id-bearing nodes carry `_id`):

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2, "_id": "<uuid-1>" },
      "content": [{ "type": "text", "text": "Orders" }]
    },
    {
      "type": "resizeNode",
      "attrs": { "height": 400, "minHeight": 200 },
      "content": [{ "type": "cardEmbed", "attrs": { "id": 114, "name": null, "_id": "<uuid-2>" } }]
    },
    { "type": "paragraph", "attrs": { "_id": "<uuid-3>" } }
  ]
}
```

To embed an existing card, find its id with `mb card list --profile <name> --json` (or `mb search --models card "<text>"`), then reference it in a `cardEmbed`.

## Creating brand-new cards inline with the document

You can create cards atomically with the document instead of pre-creating them. Reference each new card by a **negative** id in its `cardEmbed.attrs.id`, then supply the card definitions in a top-level `cards` map keyed by the same negative ids. The server creates the real cards and rewrites the negative ids to the real positive ids in the stored body.

```json
{
  "name": "Auto report",
  "document": {
    "type": "doc",
    "content": [
      { "type": "cardEmbed", "attrs": { "id": -1, "name": null, "_id": "<uuid-1>" } },
      { "type": "paragraph", "attrs": { "_id": "<uuid-2>" } }
    ]
  },
  "cards": {
    "-1": {
      "name": "Order count",
      "display": "scalar",
      "dataset_query": { "...": "an MBQL or native query — see the mbql skill" },
      "visualization_settings": {}
    }
  }
}
```

Each entry in `cards` needs at least `{name, dataset_query, display, visualization_settings}` (these are card definitions, not TipTap nodes, so they take no `_id`). Author the `dataset_query` with the `mbql` skill (`mb skills get mbql`) and the `visualization_settings` with the `viz` skill. For most edits, prefer embedding cards that already exist (a plain positive `id` in `cardEmbed`) — inline creation is for "build the report and its questions in one shot".

## Iterating on a document

`update` replaces the whole `document` body, so the safe loop is **read → edit → write**. A fetched body already carries `_id`s on its id-bearing nodes, so preserve them — only mint new ones for id-bearing nodes you add:

```bash
mb document get <id> --full --profile <name> --json | jq '.document' > ./.scratch/body.json
# edit ./.scratch/body.json (add nodes — give each new id-bearing node a fresh `mb uuid` _id) …
jq -n --slurpfile d ./.scratch/body.json '{document: $d[0]}' > ./.scratch/patch.json
mb document update <id> --file ./.scratch/patch.json --profile <name> --json
```

Don't hand-merge a partial node tree into a live document — pull the current `document`, mutate the array, and PUT the whole thing back. To rename without touching the body, patch only `name`: `mb document update <id> --body '{"name":"New title"}'`.

## Don't

- Don't omit `_id` on an id-bearing node (`paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed`, `supportingText`) — `create`/`update` reject the body ("did not match expected schema"). Mint ids with `mb uuid`.
- Don't paste a whole `document get` response into `update` — `update` only accepts `name`, `document`, `collection_id`, `collection_position`, `archived`. Send the body under the `document` key, not the full record.
- Don't put the full `document` body in `list` expectations — `list` is compact and omits it by design; use `get --full`.
- Don't invent node types. Stick to the inventory above; unknown block types render as empty/broken in the editor even though the response schema is lenient.
- Don't author a card's `dataset_query` or `visualization_settings` from this skill alone — load `mbql` and `viz`.
