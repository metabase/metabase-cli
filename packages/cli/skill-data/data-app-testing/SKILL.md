---
name: data-app-testing
description: Test a Metabase data app — a unit test next to each component with Vitest, Testing Library and the SDK's `MetabaseTestProvider`, its queries and actions mocked from `src/metabase.ts`, and runtime clauses in a `<Component>.query.ts` file the component and its test share. Triggers — "test the data app", "add tests", "mock a query", "the test fails with No mock for query". Creating and publishing the app is `data-app`; its hooks are `data-app-data` and `data-app-actions`.
allowed-tools: Read, Write, Edit, Bash
requires: [dataApps]
---

# Testing a data app

## Unit tests

Every component that renders data or runs an action gets a test next to it, `<Component>.test.tsx`. `npm run test:unit` runs them with Vitest, jsdom and Testing Library, with no Metabase instance: `renderWithProviders` in `src/test/render.tsx` wraps the component in `MetabaseTestProvider` from `@metabase/embedding-sdk-react/testing`, and the test passes the answer to every query and action the component runs. Add the app's own providers (theme, router) to `renderWithProviders`; leave the rest of the file as it is. The template's `src/App.test.tsx` checks the starter heading: rewrite it for the app's `App` once the starter page goes.

```tsx
import { mockDataAppQuery } from "@metabase/embedding-sdk-react/testing";
import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { queries } from "../metabase";
import { renderWithProviders } from "../test/render";

import { OrdersTable } from "./OrdersTable";

it("shows orders", async () => {
  renderWithProviders(<OrdersTable />, {
    dataAppQueries: [mockDataAppQuery(queries.ordersList, [{ ID: 1, STATUS: "paid" }])],
  });

  expect(await screen.findByText("paid")).toBeInTheDocument();
});
```

- Rows are typed from `src/metabase.ts`, and partial: give the columns the test asserts on; the rest get a default for their type.
- Assert what the user sees, found by role or text, and wait for data with `findBy…`. Drive interactions with `@testing-library/user-event`.
- `mockDataAppQueryError` and `mockDataAppActionError` answer with an error, for the error state of a component that runs the query with `useMetabaseQuery` or the action with `useAction`. A query with runtime clauses takes them as the second argument, as `mockDataAppQuery` does: `mockDataAppQueryError(queries.ordersList, ordersByStatus, { status: 500, message: "Query failed" })`.
- An SDK component such as `StaticQuestion` renders only its children unless the test passes one: `StaticQuestion: () => <p>Revenue chart</p>`. A panel it draws still needs its query mocked, since `useMetabaseQueryObject` resolves it (the rows don't matter); its query runs inside the component, so that panel's error state is the end-to-end tests' to check.

### Runtime clauses: `<Component>.query.ts`

A mock answers a query only when its runtime clauses equal what the component passes (`enabled` aside). So a component keeps its clauses in a `<Component>.query.ts` file next to it, and the component and its test import the same value:

```ts
// OrdersByStatus.query.ts
import { aggregations, filter } from "@metabase/embedding-sdk-react/data-app";

export const ordersByStatus = {
  breakouts: [{ type: "column", name: "STATUS" }],
  aggregations: [aggregations.count()],
} as const;

export function ordersWithStatus(status: string) {
  return { filters: [filter({ type: "column", name: "STATUS" }, "=", status)] } as const;
}
```

```tsx
// OrdersByStatus.tsx
const { data } = useMetabaseQuery(queries.ordersList, ordersByStatus);

// OrdersByStatus.test.tsx
renderWithProviders(<OrdersByStatus />, {
  dataAppQueries: [
    mockDataAppQuery(queries.ordersList, ordersByStatus, [{ STATUS: "paid", count: 12 }]),
  ],
});
```

Clauses built from state are a function of that state, as `ordersWithStatus` is: the test mocks the call for each value it selects. A request no mock matches fails with `No mock for query "<name>"`: the clauses differ from every mock, or the query has none.

### Actions

```tsx
import { mockDataAppAction } from "@metabase/embedding-sdk-react/testing";
import userEvent from "@testing-library/user-event";

const updateOrder = mockDataAppAction(actions.updateOrder, { "rows-updated": 1 });

renderWithProviders(<OrderPage />, { dataAppActions: [updateOrder] });

await userEvent.click(screen.getByRole("button", { name: "Mark as refunded" }));
expect(updateOrder.lastCall()?.parameters).toEqual({
  id: 1,
  customer_id: 3,
  total: 42.5,
  status: "refunded",
});
```

The response is what the action's kind answers (`data-app-actions`): `created-row` for an insert, `rows-updated` for an update, `rows-deleted` for a delete. `calls()` lists every call, `lastCall()` the latest.

## Before handoff

Run `npm run test:unit` and `npm run typecheck` after every round of edits; both pass before the app is built and published (`data-app`, _Build and publish_).
