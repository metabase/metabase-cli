---
name: document
description: Author and edit Metabase documents — the TipTap (ProseMirror) JSON body shape, the node-type inventory (paragraphs, headings, lists, plus the Metabase-custom `cardEmbed` / `smartLink` / `flexContainer` / `resizeNode`), the per-node-type `_id` attribute, embedding existing or brand-new cards, and the read → edit → write loop. Load when the user touches documents — "create a document", "add a card to a document", "edit a document", "find a document".
---

# Documents

A **document** is a Metabase rich-text page (a "report" / notebook) that mixes prose with embedded saved questions and links to other Metabase entities. The body is a **TipTap** JSON tree (TipTap is the editor; the wire format is ProseMirror JSON, stored under `content_type: "application/json+vnd.prose-mirror"`).

This skill covers authoring the body and driving the writes.

## Tool surface

- **Find** a document: `search` with `type: ["document"]`, or `browse_collection` on the collection that holds it. Both return the compact record (`{id, name, collection_id, archived, creator_id, can_write}`) without the (potentially huge) body.
- **Read** one: `get_content` with `{items: [{type: "document", id: 7}], response_format: "detailed"}`. The default `concise` format projects to the compact record and drops the body — `detailed` is what carries the `document` tree you are about to edit. `include: ["revisions"]` attaches its revision history.
- **Write** one: `document_write` with `method: "create" | "update" | "delete"`.
  - `create` requires `name` plus the body; `collection_id` is optional (omit it to file the document in "Our analytics", the root). Any normal analytics collection id works — unlike transforms, documents are not namespace-restricted.
  - `update` requires `id` and takes only the keys you want to change: `name`, the body, `collection_id`, `archived`, `cards`. Sending the body replaces the **whole** tree; there is no partial-node patch.
  - `archived: true` on `update` sends the document to the trash (recoverable); `archived: false` restores it. `method: "delete"` destroys it outright — permanent, and not what "delete this document" usually means. Cards the document embedded by id survive either way.

## Passing the body

The body reaches `document_write` through exactly one of two arguments — supplying both is an error:

- `document` — the tree inline, as a JSON object argument. Fine for a short document.
- `document_file` — a path to a JSON file holding the same tree. Write the file with the `write` tool first (a relative path resolves against your working directory), then name it here. A real report is hundreds of lines of nested JSON; on disk you can edit it with the file tools instead of re-emitting it into the conversation on every revision. Prefer this for anything past a few nodes. On `pull` the same parameter names where the tool writes the saved tree (default `document-<id>.json`).

Either way the value is the TipTap tree itself — a root `doc` node — not a wrapper object around it.

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "Weekly report" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Orders trended up this week." }]
    }
  ]
}
```

## Node ids (`_id`)

The editor anchors these node types with an `_id` (a UUID): `paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed`, `supportingText`. The server rejects a body where one of them is missing its `attrs._id`, and without the ids the editor backfills them when the document opens, which makes a freshly-saved document show a spurious "unsaved changes" prompt.

**`document_write` mints the missing ones for you.** Leave `_id` out of the nodes you author — you MUST NOT invent one. It only fills gaps: a node that already carries a non-empty `_id` — every id-bearing node in a body you fetched — keeps the one it has, so an edited tree round-trips with its anchors intact. Other node types (`doc`, `text`, `listItem`, `resizeNode`, `flexContainer`, …) take no `_id` at all.

## Node inventory

Every node is `{ "type": string, "attrs"?: object, "content"?: [nodes], "text"?: string, "marks"?: [marks] }`.

**Standard text nodes** (TipTap StarterKit):

- `doc` — the root; `content` holds block nodes.
- `paragraph` — `content` is inline nodes (usually `text`). An empty paragraph (`{ "type": "paragraph" }`) is a blank line.
- `text` — a leaf with `text` and optional `marks`.
- `heading` — `attrs.level` 1–6.
- `bulletList` / `orderedList` — `content` is `listItem` nodes; each `listItem` wraps `paragraph`(s).
- `blockquote`, `codeBlock`, `horizontalRule`, `hardBreak`, `image`.

**Marks** on `text` (the `marks` array): `bold`, `italic`, `strike`, `code`, plus `link` (`attrs.href`). Example: `{ "type": "text", "text": "important", "marks": [{ "type": "bold" }] }`.

**Metabase-custom nodes** (the reason a document is more than a wiki page):

- **`cardEmbed`** — an embedded saved question, which re-runs whenever the document is opened. Block, atomic. `attrs: { "id": <card-id>, "name": <string|null> }`. `name` overrides the displayed title (`null` = use the card's own name). Card embeds are commonly wrapped in a `resizeNode` to give them a fixed height.
- **`resizeNode`** — wraps a single `cardEmbed` or `flexContainer` to make it resizable. `attrs: { "height": <px>, "minHeight": <px> }`, `content` is exactly one `cardEmbed`/`flexContainer`.
- **`flexContainer`** — a horizontal row of 1–3 `cardEmbed` / `supportingText` cells side by side. `attrs.columnWidths` is an array of width percentages.
- **`supportingText`** — a text column that sits next to a card inside a `flexContainer`; `content` is the usual block nodes (`paragraph`, `heading`, lists, …).
- **`smartLink`** — an inline reference to a Metabase entity (renders as a live chip). Inline, atomic. `attrs: { "entityId": <id>, "model": <model>, "label": <string|null>, "href": <relative-path> }`. `model` ∈ `card`, `dataset`, `metric`, `dashboard`, `collection`, `table`, `database`, `document`, `transform`, `segment`, `user`, `action`, `indexed-entity` (plus `measure` on v60+).
- **`metabot`** — an inline Metabot prompt block.

## Embedding an existing card

Find the id with `search` (`type: ["question"]`) or `browse_collection`, then reference it in a `cardEmbed`. A document embedding existing card 114 under a heading:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "Orders" }]
    },
    {
      "type": "resizeNode",
      "attrs": { "height": 400, "minHeight": 200 },
      "content": [{ "type": "cardEmbed", "attrs": { "id": 114, "name": null } }]
    },
    { "type": "paragraph" }
  ]
}
```

## Creating brand-new cards inline with the document

You can create cards atomically with the document instead of pre-creating them. Reference each new card by a **negative** id in its `cardEmbed.attrs.id`, then supply the card definitions in `document_write`'s `cards` argument, a map keyed by the same negative ids. The server creates the real cards and rewrites the negative ids to the real positive ids in the stored body.

The body:

```json
{
  "type": "doc",
  "content": [
    { "type": "cardEmbed", "attrs": { "id": -1, "name": null } },
    { "type": "paragraph" }
  ]
}
```

and alongside it, `cards`:

```json
{
  "-1": {
    "name": "Order count",
    "display": "scalar",
    "dataset_query": { "...": "an MBQL or native query — see the mbql skill" },
    "visualization_settings": {}
  }
}
```

Each entry in `cards` needs at least `{name, dataset_query, display, visualization_settings}` (these are card definitions, not TipTap nodes, so they take no `_id`). Author the `dataset_query` with the `mbql` skill and the `visualization_settings` with the `visualization` skill. `cards` works on `update` as well as `create`.

Reach for inline creation only for a card that exists solely inside this document — "build the report and its questions in one shot". A card that should be reusable is created with `question_write` and embedded by its real positive id.

## Iterating on a document

Sending the body replaces the whole tree, so the safe loop is **pull → edit → update**:

1. `document_write` with `{method: "pull", id: <id>}` — the tool writes the saved tree to a file (default `document-<id>.json`, or name one with `document_file`). The tree lands on disk exactly as stored, `_id` anchors and all, without ever passing through the conversation.
2. Edit the file — add, remove, reorder nodes in the `content` array. The id-bearing nodes carry their `_id`s already; leave them exactly as they are, and don't invent `_id`s for the nodes you add.
3. `document_write` with `{method: "update", id: <id>, document_file: "<same path>"}`.

Don't hand-merge a partial node tree into a live document, and don't rebuild the tree from memory of its contents — pull the current body, mutate the array on disk, write the whole thing back.

To rename without touching the body, send only the name: `{method: "update", id: <id>, name: "New title"}`. Omitting the body on `update` leaves it untouched.

## Don't

- Don't invent node types. Stick to the inventory above; unknown block types render as empty/broken in the editor even though the response schema is lenient.
