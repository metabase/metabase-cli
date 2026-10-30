---
name: data-action
description: Author and run Metabase data actions with the `mb` CLI — table actions that insert, update or delete one row of a table, and query actions that run a parameterized native SQL write (INSERT, UPDATE, DELETE), filed in a collection and run with values. Covers enabling them on a database, picking the type, the collection they go in, each type's body and parameters, running, and the lifecycle. Triggers — "add a data action", "let users update a row", "a button that inserts a record", "add a record to a table", "run a write query", "a form that saves to the database", "delete rows from Metabase". Inside a data app, start with `data-app-actions`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataActionsWithoutModel]
---

# Data actions

A **data action** writes to a database with named inputs. A **table action** (`type: "implicit"`) inserts, updates or deletes one row of a table; a **query action** (`type: "query"`) runs one native SQL statement — `INSERT`, `UPDATE` or `DELETE`. Either lives in a collection, and dashboards, apps and `mb data-action execute` run it with values.

Flag conventions and `./.scratch` are in `core`; the native query and its template tags follow `native-sql`. This skill covers what a data action adds.

## Pick the type

- **Table action** (_Table actions_) for a write of one row by its primary key: insert a row, change some of its columns, delete it. There is no SQL to write.
- **Query action** (_Query actions_) for anything else: a computed value (`now()`), several rows or tables, rows matched by another column, a table without exactly one primary key, or setting a column to `NULL`.

## Check the database first

Data actions are off on every database until an admin turns on **Data actions** for it ("Allow data actions that use this database to be run", Admin → Databases → the database). That toggle is the database setting `database-enable-actions`.

```bash
mb db get <id> --full --json
```

- `features` must contain `"actions"` — otherwise the driver cannot run writes; pick another database.
- `settings["database-enable-actions"]` must be `true`. Create and execute fail with `Actions are not enabled.` until then. An admin profile turns it on with `mb db set-data-actions <id> true`; anyone else asks an admin to. Turning it on lets anyone with access to the database's actions write to it, so confirm with the user first.

## Pick the collection

A data action goes in a data actions collection or the data actions root (omit `collection_id`); a data app defines its own (`data-app-actions`). A regular collection is refused with `An action without a model can only go in a data actions or data app collection.` Make one with:

```bash
mb collection create --namespace data-actions --body '{"name":"Order actions"}' --json
```

## Query actions

Mint one template-tag `id` per tag with `mb uuid --count <n> --format text`.

```json
{
  "name": "Set order note",
  "type": "query",
  "collection_id": 12,
  "dataset_query": {
    "lib/type": "mbql/query",
    "database": 1,
    "stages": [
      {
        "lib/type": "mbql.stage/native",
        "native": "UPDATE orders SET note = {{note}} WHERE id = {{order_id}}",
        "template-tags": {
          "order_id": {
            "id": "6f1c9a4e-2b7d-4e0a-9c3f-1d2e3f4a5b6c",
            "name": "order_id",
            "display-name": "Order ID",
            "type": "number",
            "required": true
          },
          "note": {
            "id": "0b8d7c6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e",
            "name": "note",
            "display-name": "Note",
            "type": "text",
            "required": true
          }
        }
      }
    ]
  },
  "parameters": [
    {
      "id": "order_id",
      "slug": "order_id",
      "name": "Order ID",
      "type": "number/=",
      "target": ["variable", ["template-tag", "order_id"]],
      "required": true
    },
    {
      "id": "note",
      "slug": "note",
      "name": "Note",
      "type": "string/=",
      "target": ["variable", ["template-tag", "note"]],
      "required": true
    }
  ]
}
```

- Never set `model_id`; `mb data-action create` refuses it.
- `dataset_query.database` is the database the action writes to (`mb db list`); Metabase takes the action's `database_id` from it. `collection_id` is the data actions collection (here `12`); omit it for the data actions root.
- A template tag's `id` is a UUID, unique among the tags: the representation schema requires one.
- One statement, no `;`. `create` and `update` validate `dataset_query` as `native-sql` does.

### Parameters: one per template tag

Each `{{name}}` needs a `template-tags` entry and a `parameters` entry, all using the same name:

| Tag `type` | Parameter `type` |
| ---------- | ---------------- |
| `number`   | `number/=`       |
| `text`     | `string/=`       |
| `date`     | `date/single`    |
| `boolean`  | `boolean/=`      |

- Parameter `id` and `slug` are the tag name (not the tag's UUID `id`); `target` is `["variable", ["template-tag", "<name>"]]`.
- Use raw variables only. A field filter (`type: "dimension"`), snippet or card reference does not work in a write — write the comparison yourself (`WHERE id = {{order_id}}`).
- Set `required: true` on every input the statement cannot run without (`WHERE` keys, `NOT NULL` columns).
- Wrap an optional input in `[[ … ]]` with `required: false`; the clause drops out when no value is given. This makes one action do partial updates: `UPDATE orders SET updated_at = now() [[, note = {{note}}]] [[, status = {{status}}]] WHERE id = {{order_id}}`.

## Table actions

```json
{
  "name": "Add customer",
  "type": "implicit",
  "kind": "row/create",
  "table_id": 7,
  "collection_id": 12
}
```

- `kind` is `row/create`, `row/update` or `row/delete`; `table_id` comes from `mb table list --db-id <id>`. The table needs exactly one primary key, or create answers `An implicit action needs a table with exactly one primary key.`
- The body has no `dataset_query` or `parameters`: Metabase derives the parameters from the table's columns, without sensitive and retired ones. Each parameter `id` is its column name, slugified; `mb data-action get <id> --full --json` lists them.

| `kind`       | Parameters                             | Answers                                                                 |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------- |
| `row/create` | every column but an auto-increment key | `{"created-row": {...}}`: the new row's parameter columns, key included |
| `row/update` | the key and every other column         | `{"rows-updated": 1}`                                                   |
| `row/delete` | the key                                | `{"rows-deleted": 1}`                                                   |

- `required` marks each `NOT NULL` column without a default, and the key of an update or delete. Execution itself checks only that an update or delete has the key; an insert without a `NOT NULL` column fails in the database.
- An update writes only the columns given a value. A `null` value is dropped, so an update can't clear a column. A key that matches no row is refused: `Sorry, the row you're trying to update doesn't exist` (or `delete`).
- `visualization_settings.fields.<parameter id>.hidden: true` hides a parameter: execution refuses a value for it. Hide a column an insert needs only when the same field has a `defaultValue`.
- A patch (_Lifecycle_) changes a query action's `dataset_query` or a table action's `kind` and `table_id`, never both.

## Run it

```bash
mb data-action execute <id> --body '{"parameters":{"order_id":1042,"note":"rush delivery"}}'
```

`parameters` is keyed by parameter `id`. A query action refuses a missing required value and answers `{"rows-affected": <n>}`; a table action answers as _Table actions_ shows. A run cannot be undone, so confirm with the user before running against data that matters, and test a new action on a row created for the purpose.

## Lifecycle

| Task                  | Command                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Find                  | `mb data-action list` (unarchived only), `mb search --models action <text>`              |
| Inspect               | `mb data-action get <id> --full --json`                                                  |
| Change a query action | `mb data-action update <id> --file patch.json` (changed fields only)                     |
| Change a table action | `mb data-action update <id> --body '{"kind":"row/update"}'` (or `table_id`)              |
| Move                  | `mb data-action update <id> --body '{"collection_id":<id>}'`                             |
| Archive / restore     | `mb data-action archive <id>` / `mb data-action update <id> --body '{"archived":false}'` |
| Delete                | `mb data-action delete <id> --yes` (also removes the dashboard buttons that run it)      |

Archiving or deleting a collection archives or deletes its data actions. Existing data actions of a model still list, run and archive; leave them as they are.

## Don't

- Don't create a model for a data action.
- Don't concatenate values into the SQL; every value goes through a template tag.
- Don't run a data action on production data without the user's go-ahead.
