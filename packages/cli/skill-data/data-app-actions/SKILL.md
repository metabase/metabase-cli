---
name: data-app-actions
description: Make a Metabase data app write data — an action in the app's collection (a table action that inserts, updates or deletes a row, or a SQL query action), its typed definition in `src/metabase.ts`, and the `useAction` hook from `@metabase/embedding-sdk-react/data-app` behind a form or a button, with inputs typed from each parameter, the server's error shown as it comes, and every affected query refreshed. Triggers — "a form that saves a row", "a button that updates a record", "delete an entry from the app", "submit doesn't refresh the list", "the action fails in the app". Creating the action itself is `data-action`; reads are `data-app-data`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Writes in a data app

An **action** is a table action, which inserts, updates or deletes one row of a table, or a query action, a saved SQL write (`data-action`). A data app runs only the actions in **the app's collection** (`data-app`, _Create the app_).

1. Draft the action as `data-action` describes, with `collection_id` the app's collection: the database must allow actions, and a table action's table must be published to the Library, as every table the app reads is. Pick the type as `data-action`, _Pick the type_, says. Show the user the table and kind, or the SQL, and the parameters; create it once they agree.
2. Regenerate `src/metabase.ts` (`data-app-data`).
3. Pass `actions.<name>` from it to `useAction`.

An action in the app's collection can't be archived: to drop one, move it to a data actions collection (`mb data-action update <id> --body '{"collection_id":<id>}'`), then archive it.

Each action there lists its parameters: the parameter slug (the key `execute` takes), `displayName` (a label, never a key), `jsType` (`string`, `number`, `Date`, `boolean` or `unknown`) and `required`. Never fake a call to an action `src/metabase.ts` doesn't list.

## The hook

```tsx
import { useAction } from "@metabase/embedding-sdk-react/data-app";
import { actions } from "../metabase";

const { execute, isExecuting, result, error, reset } = useAction(actions.setOrderNote);
```

- **Import it from `/data-app`.** The main `@metabase/embedding-sdk-react` entry exports the general SDK `useAction`, which takes raw ids and isn't typed from the definition. Write no generics: the definition types `execute`'s keys and values.
- `execute(params)` resolves to the response body; on failure it both throws and sets `error`. It resolves to `null` without sending anything while the SDK is still starting, so guard a call that can happen at mount. It never runs on its own and has no `enabled`: return early in the handler to skip it.
- `isExecuting` is true until it settles: disable the trigger and show progress, so a double click can't send twice.
- `result` is the last response, `null` before the first call; a query action answers `{"rows-affected": <n>}`, a table action `rows-updated`, `rows-deleted` or `created-row` (`data-action`, _Table actions_). `reset()` clears `result` and `error`, for example when the user dismisses a message.

## A form

```tsx
export function NoteForm({ orderId, onSaved }: { orderId: number; onSaved: () => Promise<void> }) {
  const { execute, isExecuting, error } = useAction(actions.setOrderNote);
  const [note, setNote] = useState("");
  const [isValid, setIsValid] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await execute({ order_id: orderId, note }); // keys are parameter slugs
      await onSaved(); // the parent refetches what the write changed
      setNote("");
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

**Inputs.** Pick each input's type from `jsType`, never from the parameter slug — one called `email` with `jsType: "string"` is still `type="text"`.

| `jsType`  | Input                                                      |
| --------- | ---------------------------------------------------------- |
| `string`  | `type="text"`                                              |
| `number`  | `type="number"`, read with `valueAsNumber`                 |
| `boolean` | a checkbox or switch                                       |
| `Date`    | `type="date"`, or `datetime-local` when a time is expected |
| `unknown` | `type="text"`, converted at the call                       |

**Table actions.** The parameter slugs are the table's column names, slugified.

- **Insert** (`row/create`): every column but an auto-increment key. `result["created-row"]` holds the new row's parameter columns, its key among them.
- **Update** (`row/update`): the key and every other column, `required` on each `NOT NULL` one without a default. Start the form from the row's current values, read by the query on screen, and send them all. A `null` is dropped, so an update can't clear a column.
- **Delete** (`row/delete`): the key only. Ask the viewer to confirm first.

**Validation** is `required` on each required parameter and nothing else — no length, range or format checks of your own. Disable submit from the browser's verdict, `form.checkValidity()`, never from hand-rolled checks. Anything stricter comes back from the server.

**Errors.** `error` is `{ status?, data: { message?, errors? }, isCancelled }` — read it without a cast. A failing query action comes back as a 500 whose `data.message` wraps the driver's text (`Error executing Action: …`): show it as it comes, in a `white-space: pre-wrap` element, since driver messages span lines — never "Something went wrong", `String(error)` or a friendlier paraphrase. A table action's refusals and constraint errors are 400s, shown the same way (`Sorry, the row you're trying to update doesn't exist`). `error.data.errors?.[parameterSlug]`, when present, goes beside its field (`aria-invalid` on the input).

## Refresh

After a write succeeds, refetch every query on screen it could have changed: `await Promise.all([orders.refetch(), totals.refetch()])`, the `refetch` that `useMetabaseQuery` returns.

- Those queries live in a component above the trigger, which passes the refresh down; a query in the trigger's own component or below it can't be wired to it.
- A `StaticQuestion` panel has no `refetch`: give it a `key` the parent bumps after the write, which remounts it and runs the question again.
- Await the refresh before clearing the form or closing the modal, so stale rows never flash.
- Never prepend `result` to a local list instead: ids, timestamps and computed columns come from the server.

## When it doesn't work

1. Log `result`, `error` and the object passed to `execute`: every key is a parameter slug, every value matches its `jsType`.
2. `execute` resolved to `null` and nothing was sent: it ran before the SDK started.
3. The screen doesn't update: see _Refresh_.
4. The action is missing from `src/metabase.ts`: it isn't in the app's collection, or the file is stale — regenerate it.

Then build and publish (`data-app`, _Build and publish_).
