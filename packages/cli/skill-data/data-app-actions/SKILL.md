---
name: data-app-actions
description: Make a Metabase data app write data — a table action that inserts, updates or deletes a row of a published table, defined with `defineAction` in `src/metabase.actions.ts`, and the `useAction` hook from `@metabase/embedding-sdk-react/data-app` behind a form or a button, with inputs typed from each parameter, the server's error shown as it comes, and every affected query refreshed. Triggers — "a form that saves a row", "a button that updates a record", "delete an entry from the app", "submit doesn't refresh the list", "the action fails in the app". Reads are `data-app-data`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Writes in a data app

A data app writes through **table actions**: an insert, update or delete of one row of a table published to the Library, by its primary key. It defines each one in `src/metabase.actions.ts`, one export per action:

```ts
import { defineAction } from "@metabase/embedding-sdk-react/data-app";

import { schema } from "./metabase.schema";

export const updateOrder = defineAction({
  entityId: "J2mXq8sLb0vT5nYcW4kRd",
  kind: "row/update",
  table: schema.tables.orders,
});
```

- `kind` is `row/create`, `row/update` or `row/delete`; `table` is a table of `schema` (`data-app-data`). The table needs exactly one primary key, and its database needs data actions turned on (_Data actions on the database_): settle both before writing the export. Show the user the table and kind and add it once they agree; a request that already names the write ("let me add a note") is that agreement.
- `entityId` comes from `mb nano-id`, never invented; keep it when editing the export. The export's name is the action's name in Metabase.
- There are no query actions and no SQL: a write a table action can't do (a computed value, several rows, a row matched by another column) is out of reach for the app — say so. Never copy an action from a data actions collection.
- To drop an action, delete its export.

The dev preview runs the action without saving it; Metabase runs it once the app is released (`data-app`, _Release_).

## Data actions on the database

Before the first action on a database, read its toggle: `mb db get <db-id> --full --json --profile <name> | jq '.settings["database-enable-actions"]'` (`<db-id>` from `mb db list --profile <name> --json`, or `mb table get <table-id> --json --profile <name> | jq .db_id` once `src/metabase.schema.ts` gives the table's `id`). Anything but `true`, an unset `null` included, means it's off, and every action on that database fails with `Actions are not enabled.`, in the preview and in Metabase. Then ask with `AskUserQuestion` ("Data actions are off on <database>. Turning them on lets anyone with access to its actions write to it."), offering:

- **Turn them on now**: run `mb db set-data-actions <db-id> true --profile <name>`, then read the toggle again.
- **I'll turn them on**: the user does it in Admin → Databases → the database ("Allow data actions that use this database to be run"); wait for them, then read the toggle again before going on.
- **No writes**: build the app without actions, and tell the user which features that leaves out.

Never turn the toggle on without that yes.

## The hook

```tsx
import { useAction } from "@metabase/embedding-sdk-react/data-app";
import { updateOrder } from "../metabase.actions";

const { execute, isExecuting, result, error, reset } = useAction(updateOrder);
```

- **Import it from `/data-app`.** The main `@metabase/embedding-sdk-react` entry exports the general SDK `useAction`, which takes raw ids and isn't typed from the definition. Write no generics: the definition types `execute`'s keys and values.
- `execute(params)` resolves to the response body; on failure it both throws and sets `error`. It resolves to `null` without sending anything while the SDK is still starting, so guard a call that can happen at mount. It never runs on its own and has no `enabled`: return early in the handler to skip it.
- `isExecuting` is true until it settles: disable the trigger and show progress, so a double click can't send twice.
- `result` is the last response, `null` before the first call: `{ "created-row": <the new row> }` for an insert, `{ "rows-updated": <n> }` for an update, `{ "rows-deleted": <n> }` for a delete. `reset()` clears `result` and `error`, for example when the user dismisses a message.

## A form

```tsx
export function NoteForm({ orderId, onSaved }: { orderId: number; onSaved: () => Promise<void> }) {
  const { execute, isExecuting, error } = useAction(updateOrder);
  const [note, setNote] = useState("");
  const [isValid, setIsValid] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await execute({ id: orderId, note }); // keys are column names, in lowercase
      await onSaved(); // the parent refetches what the write changed
      setNote("");
      setIsValid(false);
    } catch {
      // shown from `error`
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={(event) => setIsValid(event.currentTarget.checkValidity())}>
      <input type="text" required value={note} onChange={(event) => setNote(event.target.value)} />
      <button type="submit" disabled={isExecuting || !isValid}>
        {isExecuting ? "Saving…" : "Save"}
      </button>
      {error ? (
        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {error.data.message ?? "Action failed."}
        </pre>
      ) : null}
    </form>
  );
}
```

**Parameters.** The keys `execute` takes are the table's column names in lowercase (`CREATED_AT` becomes `created_at`; names already in lowercase stay as they are), each typed from its field's `jsType` in `src/metabase.schema.ts`, and all optional in the type. Pick each input from `jsType`, never from the name — a column called `email` with `jsType: "string"` is still `type="text"`.

| `jsType`  | Input                                                      |
| --------- | ---------------------------------------------------------- |
| `string`  | `type="text"`; a `<textarea>` for long text such as a note |
| `number`  | `type="number"`, read with `valueAsNumber`                 |
| `boolean` | a checkbox or switch                                       |
| `Date`    | `type="date"`, or `datetime-local` when a time is expected |
| `unknown` | `type="text"`, converted at the call                       |

- **Insert** (`row/create`): every column but an auto-increment key and the columns the database fills when the form leaves them out, such as a `created_at` or `status` with a default. `mb table get <id> --include fields --full --json` gives each field's `database_required` and `database_default`. `result["created-row"]` holds the new row, its key among them.
- **Update** (`row/update`): the key and the columns to change. An edit form starts from the row's current values, read by the query on screen, and sends them all; a button that sets one column (mark as done) sends only the key and that column. A fixed value such as `"done"` comes from the column's values (`mb field values <field-id> --profile <name>`), never a guess. A `null` is dropped, so an update can't clear a column.
- **Delete** (`row/delete`): the key only. Ask the viewer to confirm first.

**Validation** is `required` on the key of an update or delete and on each `NOT NULL` column without a default in an insert, and nothing else — no length, range or format checks of your own. Disable submit from the browser's verdict, `form.checkValidity()`, never from hand-rolled checks. Anything stricter comes back from the server.

**Errors.** `error` is `{ status?, data: { message?, errors? }, isCancelled }` — read it without a cast. Refusals and constraint errors are 400s whose `data.message` carries the server's text (`Sorry, the row you're trying to update doesn't exist`): show it as it comes, in a `white-space: pre-wrap` element, since driver messages span lines — never "Something went wrong", `String(error)` or a friendlier paraphrase. `error.data.errors?.[parameter]`, when present, goes beside its field (`aria-invalid` on the input).

## Refresh

After a write succeeds, refetch every query on screen it could have changed: `await Promise.all([orders.refetch(), totals.refetch()])`, the `refetch` that `useMetabaseQuery` returns.

- Those queries live in a component above the trigger, which passes the refresh down; a query in the trigger's own component or below it can't be wired to it.
- A `StaticQuestion` panel has no `refetch`: give it a `key` the parent bumps after the write, which remounts it and runs the question again.
- Await the refresh before clearing the form or closing the modal, so stale rows never flash.
- Never prepend `result` to a local list instead: ids, timestamps and computed columns come from the server.

## When it doesn't work

1. Log `result`, `error` and the object passed to `execute`: every key is a lowercase column name, every value matches its `jsType`.
2. `execute` resolved to `null` and nothing was sent: it ran before the SDK started.
3. The screen doesn't update: see _Refresh_.
4. It works in the preview but not in Metabase: the app was released without running `mb data-app generate-actions` (`data-app`, _Release_).

Then release the app (`data-app`, _Release_).
