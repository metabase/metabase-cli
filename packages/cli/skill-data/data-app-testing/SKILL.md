---
name: data-app-testing
description: Test a Metabase data app — a unit test next to each component with Vitest, Testing Library and the SDK's `MetabaseTestProvider`, its questions and actions mocked from the exports of `src/metabase.queries.ts` and `src/metabase.actions.ts`, and runtime clauses in a `<Component>.query.ts` file the component and its test share; a Playwright spec per page against the dev preview and real data. Triggers — "test the data app", "add tests", "mock a query", "the test fails with No mock for query", "add an e2e test", "run the Playwright tests". Creating and releasing the app is `data-app`; its hooks are `data-app-data` and `data-app-actions`.
allowed-tools: Read, Write, Edit, Bash
requires: [dataApps]
---

# Testing a data app

## Unit tests

Every component that renders data or runs an action gets a test next to it, `<Component>.test.tsx`. `npm run test:unit` runs them with Vitest, jsdom and Testing Library, with no Metabase instance: `renderWithProviders` in `src/test/render.tsx` wraps the component in `MetabaseTestProvider` from `@metabase/embedding-sdk-react/testing`, and the test passes the answer to every question and action the component runs. Add the app's own providers (theme, router) to `renderWithProviders`; leave the rest of the file as it is. The template's `src/App.test.tsx` checks the starter heading: rewrite it for the app's `App` once the starter page goes.

```tsx
import { mockDataAppQuery } from "@metabase/embedding-sdk-react/testing";
import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ordersList } from "../metabase.queries";
import { renderWithProviders } from "../test/render";

import { OrdersTable } from "./OrdersTable";

it("shows orders", async () => {
  renderWithProviders(<OrdersTable />, {
    dataAppQueries: [mockDataAppQuery(ordersList, [{ ID: 1, STATUS: "paid" }])],
  });

  expect(await screen.findByText("paid")).toBeInTheDocument();
});
```

- Rows are typed from the question's export, and partial: give the columns the test asserts on. The mock answers with the query's columns, and the ones a row leaves out come back as `null`.
- Assert what the user sees, found by role or text, and wait for data with `findBy…`. Drive interactions with `@testing-library/user-event`.
- `mockDataAppQueryError` and `mockDataAppActionError` answer with an error, for the error state of a component that runs the query with `useMetabaseQuery` or the action with `useAction`. A query with runtime clauses takes them as the second argument, as `mockDataAppQuery` does: `mockDataAppQueryError(ordersList, ordersByStatus, { status: 500, message: "Query failed" })`.
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
const { data } = useMetabaseQuery(ordersList, ordersByStatus);

// OrdersByStatus.test.tsx
renderWithProviders(<OrdersByStatus />, {
  dataAppQueries: [mockDataAppQuery(ordersList, ordersByStatus, [{ STATUS: "paid", count: 12 }])],
});
```

Clauses built from state are a function of that state, as `ordersWithStatus` is: the test mocks the call for each value it selects. A request no mock matches fails with `No mock for query "<entityId>"`: the clauses differ from every mock, or the query has none.

### Actions

```tsx
import { mockDataAppAction } from "@metabase/embedding-sdk-react/testing";
import userEvent from "@testing-library/user-event";

import { updateOrder } from "../metabase.actions";

const updateOrderMock = mockDataAppAction(updateOrder, { "rows-updated": 1 });

renderWithProviders(<OrderPage />, { dataAppActions: [updateOrderMock] });

await userEvent.click(screen.getByRole("button", { name: "Mark as refunded" }));
expect(updateOrderMock.lastCall()?.parameters).toEqual({ id: 1, status: "refunded" });
```

The response is what the action's kind answers (`data-app-actions`): `created-row` for an insert, `rows-updated` for an update, `rows-deleted` for a delete. `calls()` lists every call, `lastCall()` the latest. A parameter that isn't a column of the action's table, or whose value doesn't match the column's `jsType`, fails the call instead of reaching the mock.

## End-to-end tests

The specs in `e2e/` are Playwright tests against the dev preview (`data-app`, _Dev preview_) and the instance's real data: they check that the pieces fit — every page opens, its questions return rows, its actions exist — not that the numbers are right. `npm run test:e2e` starts the preview, or reuses one already running, so it needs `<repo>/.env.local` like `npm run dev`; the first run on a machine needs `npx playwright install chromium`.

Write one spec per page in `e2e/`. The template's `e2e/app.spec.ts` checks the starter heading: once the starter page goes, make it the first page's spec:

```ts
import { expect, test } from "@playwright/test";

test("orders page shows warehouse data", async ({ page }) => {
  await page.goto("orders");
  await expect(page.getByRole("row")).not.toHaveCount(0);
});

test("status filter updates orders table", async ({ page }) => {
  await page.goto("orders");
  await page.getByRole("combobox", { name: "Status" }).fill("refunded");
  await page.getByRole("option", { name: "refunded" }).click();
  await expect(page.getByRole("cell", { name: "paid" })).toHaveCount(0);
});
```

- Assert data, not only headings: rows, values and chart contents are what a failed query takes away. Then each interaction — a filter, sorting, a link to another page — and the view it changes.
- Locate by role and accessible name (`getByRole`, `getByLabel`), as a user finds things. A name matches as a substring unless `exact: true` is passed: "Ship order 12" also finds "Ship order 120".
- Navigate with relative paths (`page.goto("orders")`, `page.goto("")` for the first page), never `/orders`.
- An action spec opens the action's form and checks its fields. Submit it only when the user has said the app's database may be written to: a submitted action changes real data.
- A failure whose cause isn't on the page is in the diagnostics feed (`data-app`, _Dev preview_).

The same specs run in CI, with `DATA_APP_MB_URL` and `DATA_APP_MB_API_KEY` set in the job's environment, against the instance `src/metabase.schema.ts` was generated from: the preview runs each question and action by that instance's numeric IDs. CI installs the SDK from `package.json`, so it needs a published version there: a `file:` path to a local build resolves only on the machine that has it.

## Before handoff

Run `npm run test:unit` and `npm run typecheck` after every round of edits, and `npm run test:e2e` once the pages render data; all three pass before the app is released (`data-app`, _Release_).
