---
name: data-action
description: Author and run Metabase data actions with the `mb` CLI — saved, parameterized native SQL writes (INSERT, UPDATE, DELETE) with no model, filed in a data actions folder and run with values. Covers the database setting, folders, the body, template-tag parameters, running, and the lifecycle. Triggers — "add a data action", "let users update a row", "a form that saves to the database", "an app that inserts a record", "run a write query", "delete rows from Metabase".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataActionsWithoutModel, dataActionCollections, dataActionArchivedList]
---

# Data actions

A data action is one native SQL write (`INSERT`, `UPDATE` or `DELETE`) with named inputs and no model. It lives in the data actions root or a data actions folder. Data apps and `mb data-action execute` run it; dashboards don't. The query and its template tags follow `native-sql`; flags and `./.scratch` follow `core`.

## Before creating

1. **Database.** Run `mb db get <id> --full --json`.
   - `features` must contain `"actions"`. If it doesn't, the driver can't write; pick another database.
   - `settings["database-enable-actions"]` must be `true`. If it isn't, ask the user to have an admin turn on **Data actions** for the database (Admin → Databases); `mb` can't. Until then, create, execute and query changes fail with `Actions are not enabled.`
2. **Folder.** Run `mb collection list --namespace data-actions --json`; `root` is the data actions root. Make one with `mb collection create --namespace data-actions --body '{"name":"Billing"}'`. A regular collection is rejected.
3. **Access.** Folder permissions decide access: View runs an action, Curate edits it. Admins set them in Metabase; `mb` can't. Without access a call answers 403.

## Body

```json
{
  "name": "Set order note",
  "type": "query",
  "database_id": 1,
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
            "id": "order_id",
            "name": "order_id",
            "display-name": "Order ID",
            "type": "number",
            "required": true
          },
          "note": {
            "id": "note",
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

- `type` is `"query"`. Never send `model_id`.
- `database_id` equals `dataset_query.database`.
- `collection_id` is a data actions folder id; omit it for the root.
- One statement, no `;`. `create` and `update` validate `dataset_query` as `native-sql` does.

## Parameters

Each `{{name}}` needs a `template-tags` entry and a `parameters` entry with the same name as `id`, `slug` and tag name. `target` is `["variable", ["template-tag", "<name>"]]`.

| Tag `type` | Parameter `type` |
| ---------- | ---------------- |
| `number`   | `number/=`       |
| `text`     | `string/=`       |
| `date`     | `date/single`    |
| `boolean`  | `boolean/=`      |

- Raw variables only. A field filter (`type: "dimension"`), snippet or card reference doesn't work in a write; write the comparison yourself (`WHERE id = {{order_id}}`).
- `required: true` on every input the statement can't run without (`WHERE` keys, `NOT NULL` columns).
- Optional input: wrap it in `[[ … ]]` with `required: false`; the clause drops out without a value. One action can then update any subset: `UPDATE orders SET updated_at = now() [[, note = {{note}}]] [[, status = {{status}}]] WHERE id = {{order_id}}`.

## Run

```bash
mb data-action execute <id> --body '{"parameters":{"order_id":1042,"note":"rush delivery"}}'
```

`parameters` is keyed by parameter `id`. The result is `{"rows-affected": <n>}`, and a missing required value is refused. A run can't be undone: get the user's go-ahead before writing data that matters, and test a new action on a row made for the purpose.

## Lifecycle

| Task                     | Command                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Find                     | `mb data-action list`, or `mb data-action list --archived`                               |
| Inspect                  | `mb data-action get <id> --full --json`                                                  |
| Change SQL, inputs, name | `mb data-action update <id> --file patch.json` (changed fields only)                     |
| Move                     | `mb data-action update <id> --body '{"collection_id":<folder id or null>}'`              |
| Archive / restore        | `mb data-action archive <id>` / `mb data-action update <id> --body '{"archived":false}'` |
| Delete                   | `mb data-action delete <id> --yes`                                                       |

- Find data actions with `list`, not `mb search`: search leaves out the ones in folders.
- Archiving or deleting a folder archives or deletes the data actions in it.
- `list` leaves out actions that belong to a model. Those are model actions; leave them as they are.

## Don't

- Don't create a model for a data action, or file one in a regular collection.
- Don't concatenate values into the SQL; every value goes through a template tag.
- Don't run a data action on production data without the user's go-ahead.
