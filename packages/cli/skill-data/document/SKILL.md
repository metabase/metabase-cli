---
name: document
description: Author and edit Metabase document YAML in file mode. Covers the ProseMirror node tree in `document`, the node types `mb check` accepts, embedding cards with `cardEmbed` (existing cards or document-owned cards with `document_id`), `smartLink` references, and where the files go. Load when the user wants to "write a report", "create a document", "add a chart to a document", "edit a document", or edits any Document YAML file.
allowed-tools: Read, Write, Edit, Bash
---

# Documents

A document is one YAML file with `model: Document` in `serdes/meta`. Its `document` field holds a ProseMirror node tree: prose, headings, and lists, plus embedded cards and links to other Metabase content. Load `representations` first for entity_ids, `serdes/meta`, and `collection_id`.

Read the "Document" section of the spec and the schema before you write a file:

```bash
DIR=$(mb skills path representations --json | jq -r '.data[0].dir')
grep -n '^## Document' "$DIR/spec/spec.md"    # then read that section
cat "$DIR/spec/schemas/document.yaml"
```

## A document is a file plus its owned cards

```
collections/main/<collection_slug>/<doc_slug>.yaml               the document
collections/main/<collection_slug>/<doc_slug>/<card_slug>.yaml   cards owned by the document
```

Required fields: `name`, `entity_id`, `creator_id` (a user email), `document`, and `serdes/meta`. Also set `content_type: "application/json+vnd.prose-mirror"` and `collection_id`.

```yaml
name: Weekly Orders Report
entity_id: <new 21-char NanoID>
creator_id: analyst@example.com
content_type: "application/json+vnd.prose-mirror"
collection_id: <collection entity_id, or null for the root collection>
document:
  type: doc
  content:
    - type: heading
      attrs:
        level: 1
      content:
        - type: text
          text: Weekly Orders Report
    - type: paragraph
      content:
        - type: text
          text: "Orders by category. "
        - type: text
          text: Widget
          marks:
            - type: bold
        - type: text
          text: " leads revenue."
    - type: cardEmbed
      attrs:
        id:
          - model: Card
            id: <card entity_id>
        name: Orders by Category
    - type: paragraph
      content:
        - type: text
          text: "Details: "
        - type: smartLink
          attrs:
            model: dashboard
            entityId:
              - model: Dashboard
                id: <dashboard entity_id>
serdes/meta:
  - id: <same entity_id>
    label: weekly_orders_report
    model: Document
```

## `mb check` accepts only these node types

Every node is `{type, attrs?, content?, text?, marks?}`. The root is always `type: doc`.

| Node                                            | Rules                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `paragraph`, `blockquote`, `codeBlock`          | `content` is inline nodes. An empty `paragraph` is a blank line. |
| `heading`                                       | `attrs.level` 1 to 6 is required.                                |
| `bulletList`, `orderedList`                     | `content` is `listItem` nodes. Each `listItem` wraps paragraphs. |
| `table`, `tableRow`, `tableCell`, `tableHeader` | Table -> rows -> cells.                                          |
| `image`                                         | `attrs.src` is required. `alt` and `title` are optional.         |
| `text`                                          | `text` is required. `marks` holds formatting.                    |
| `hardBreak`                                     | A line break inside a paragraph.                                 |
| `cardEmbed`                                     | An embedded card. See below.                                     |
| `smartLink`                                     | An inline chip that links to another entity. See below.          |

Marks on `text`: `bold`, `italic`, `underline`, `strike`, `code`, and `link` (`attrs.href`, for example `/dashboard/<entity_id>`).

The schema rejects every other type. The Metabase editor also uses `resizeNode`, `flexContainer`, `supportingText`, and `metabot`. Don't write them: `mb check` fails on them. Put cards one per block, full width.

## `cardEmbed` references a card by entity_id

`attrs.id` is a one-item list: `[{model: Card, id: <card entity_id>}]`. Never write a numeric card id. `attrs.name` overrides the title above the card. Set `name: null` to show the card's own name.

A `cardEmbed` can point at two kinds of card:

- **A card that already exists in a collection.** Find its file in the repo and copy its `entity_id`.
- **A card that the document owns.** Use this for a new card that exists only for this report. Write the card file in the `<doc_slug>/` subfolder and set both fields:
  - `document_id`: the document's `entity_id`.
  - `collection_id`: the same value as the document's `collection_id`.

A mismatched `collection_id` puts the card in a different collection from its document. Never set both `document_id` and `dashboard_id` on one card. Write the card query with the `mbql` or `native-sql` skill and its display with `visualization`.

## `smartLink` references a card or dashboard by path

- `attrs.model` is `card`, `dataset`, or `dashboard`.
- `attrs.entityId` is `[{model: Card, id: <entity_id>}]` for `card` and `dataset`, and `[{model: Dashboard, id: <entity_id>}]` for `dashboard`.
- `label` and `href` are optional.

Import resolves only these three models to a path. For a link to a collection or another document, use a `link` mark with an `href` instead.

## Edit an existing document in place

- Read the file first. Change only the nodes you need.
- Keep every attr you didn't add, including `_id` on existing nodes. The editor uses `_id` to anchor nodes.
- To remove an owned card, delete its `cardEmbed` node and its card file together.
- To move a document, change its `collection_id` and the `collection_id` of every card it owns.
- To archive a document, set `archived: true`.

## Loop

1. Write the document file and any owned card files. Mint a new `entity_id` for each (see `representations`).
2. Get field refs for owned cards from `mb metadata`.
3. Run `mb check`. Fix each failure at its JSON path.
4. Run `mb save -m "<what changed>"`.

## Don't

- Don't use node types outside the table above. Use one full-width `cardEmbed` per block instead of layout nodes.
- Don't put numeric ids in `cardEmbed` or `smartLink`.
- Don't give an owned card a `collection_id` that differs from its document's.
- Don't delete a card file that a `cardEmbed` still references.
