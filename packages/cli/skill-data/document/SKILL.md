---
name: document
description: Author and edit Metabase documents as files, covering the ProseMirror body the file holds, the node types the format accepts (paragraphs, headings, lists, tables, images, plus `cardEmbed` and `smartLink`), node `_id`s, embedding existing cards or cards the document owns, and reading documents on the instance. Load when the user touches documents, as in "write a report", "add a card to a document", "edit a document", or anything `mb document …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Documents

A **document** is a Metabase rich-text page that mixes prose with embedded questions and links to other Metabase entities. It is a file in this repository (`mb skills get metabase-representation-format`, "Document" in `spec.md`) whose `document` field is a ProseMirror tree, `content_type: application/json+vnd.prose-mirror`. Mechanics shared by every file, including `mb entity-id`, `mb uuid` and the loop that puts a branch on the instance, live in `core`.

## Reading documents on the instance

```bash
mb document list --json                 # non-archived documents visible to you
mb document get <id> --full --json      # one document including its body
```

`list` returns the standard list envelope; its compact item omits the body. A document someone built in the UI is the model for one you write: read it back and copy its shapes, translating numeric card ids to `entity_id`s (`mb card get <id> --fields entity_id`).

## The file

```yaml
name: Weekly report
entity_id: <mb entity-id>
creator_id: <email>
collection_id: <collection entity_id>
content_type: application/json+vnd.prose-mirror
document:
  type: doc
  content:
    - type: heading
      attrs: { level: 1, _id: <mb uuid> }
      content:
        - { type: text, text: Weekly report }
    - type: paragraph
      attrs: { _id: <mb uuid> }
      content:
        - { type: text, text: Orders trended up this week. }
    - type: cardEmbed
      attrs:
        id:
          - { model: Card, id: <card entity_id> }
        name: null
        _id: <mb uuid>
serdes/meta:
  - id: <document entity_id>
    label: weekly_report
    model: Document
```

`collection_id: null` (or omitted) files it in the root collection. Documents take any ordinary collection.

## Node ids (`_id`)

The editor anchors these node types with an `_id`: `paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed`. Give every node of those types an `attrs._id` minted with `mb uuid --count <n> --json`, one per node. Without them the editor backfills ids when the document opens, and a freshly imported document shows a spurious "unsaved changes" prompt. Other node types (`doc`, `text`, `listItem`, table nodes) take none.

## Node inventory

Every node is `{type, attrs?, content?, text?, marks?}`. `mb validate` accepts these types and no others:

- `doc`: the root; `content` holds block nodes.
- `paragraph`: inline content, usually `text`. An empty paragraph is a blank line.
- `text`: a leaf with `text` and optional `marks`.
- `heading`: `attrs.level` 1 to 6.
- `bulletList`, `orderedList`: `content` is `listItem` nodes, each wrapping paragraphs.
- `blockquote`, `codeBlock`, `hardBreak`.
- `table`, `tableRow`, `tableCell`, `tableHeader`.
- `image`: `attrs.src`, optional `alt` and `title`.
- **`cardEmbed`**: an embedded card. `attrs.id` is a one-entry path `[{model: Card, id: <entity_id>}]`; `attrs.name` overrides the displayed title (`null` keeps the card's own).
- **`smartLink`**: an inline reference to any entity, rendered as a live chip. `attrs.entityId` is a path `[{model: <Model>, id: <entity_id>}]` and `attrs.model` the kind: `card`, `dataset`, `metric`, `dashboard`, `collection`, `table`, `database`, `document`, `transform`, `segment`, `user`, `action`, `indexed-entity`.
  <!-- requires: smartLinkMeasureModel -->
  - `measure` is a valid `model` too.
  <!-- /requires -->

Marks on `text`: `bold`, `italic`, `code`, `underline`, `strike`, and `link` with `attrs.href`.

## Embedding cards

**An existing card:** put its `entity_id` in the `cardEmbed` path. Find it in the card's file, or on the instance with `mb search --models card "<text>"` and `mb card get <id> --fields entity_id`.

**A card the document owns:** write the card as its own file with `document_id` set to the document's `entity_id` and the same `collection_id`, in a folder named like the document beside it, then embed it by that `entity_id`. Author its `dataset_query` with `mbql` and its `visualization_settings` with `visualization`. Prefer embedding a card that already exists when one answers the question.

## Editing

Edit the file in place: keep every existing `_id` and `entity_id`, mint new ones only for nodes and cards you add, and keep the whole tree. `mb validate` the file, then run the loop in `core`; after the import, `mb document get <id> --full --json` shows what the instance holds.

## Don't

- Don't invent node types. A type outside the inventory fails `mb validate`.
- Don't put a numeric card id in a `cardEmbed`; the path names the card's `entity_id`.
