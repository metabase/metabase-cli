---
name: data-app-ui
description: Write a Metabase data app's UI — what the sandbox blocks and what replaces it, external APIs through `allowed_hosts`, layout and sizing, the SDK theme, a custom error state, the SDK components on offer, a Metabase chart versus a hand-drawn one and its visualization settings, pages with `DataAppRouter`, and what the app may show. Triggers — "change the layout", "theme the app", "add a page", "link between pages", "call an external API from the app", "the chart overflows", "invisible chart labels", "make it look like our brand". Creating and publishing is `data-app`; its data is `data-app-data`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# A data app's UI

Before changing an existing app, pass its checks, React 19 among them (`data-app`, _An existing project_).

Everything here runs inside the sandbox, the same in the dev preview as in Metabase; check each change in the preview and its diagnostics feed (`data-app`).

## Source

- Plain ESM and TSX. SDK components come from `@metabase/embedding-sdk-react`; the data hooks, routing, `copy`, `DateRangePopover`, `DateRangeCalendar` and `useDateFormatter` from `@metabase/embedding-sdk-react/data-app`. JSX needs no `import React`; import hooks and React types by name.
- React, React DOM and both SDK entries come from the host. Never read SDK values off `globalThis`: the sandbox globals there are private.
- On Metabase 65 or earlier (`mb auth status --json | jq -r .version.tag`), the host runs React 18: write code that runs on both 18 and 19, without React 19 APIs such as `use`, `useOptimistic`, `useActionState` or async transitions. The project itself stays on React 19 (`data-app`, _An existing project_).
- The build is one self-contained file: CSS is inlined, `import logo from "./logo.png"` is a data URI, `import Icon from "./icon.svg?react"` a component (add `declare module "*.svg?react";` in a `.d.ts` under `src/` if the editor doesn't know it). Keep large binaries out. There's no `index.html` and no Vite plugin to add: solve it in `src/`.
- Once the app grows: `src/App.tsx` for routing and composition, `pages/` one file per screen, `components/`, `hooks/`, `lib/` for pure helpers.

## What the app shows

- Only what Metabase returned, or deterministic transforms of it: no sample data, invented KPIs, trends, statuses, or claims such as "real-time" or "at risk" the data doesn't support. A section no question supports is left out.
- Don't read a `rate`, `score`, `margin` or `percent` column as a percentage or threshold — no `%`, `* 100`, colors or stars — unless its `semanticType` in `src/metabase.ts`, or the user, says so.
- Every panel has a loading state, its error, and an empty state for no rows — never an empty slot or a stale value.
- Label with names, not ids; currency to two decimals, counts as integers; a `null` breakout is "Unknown". A trend needs several points: never a sparkline from one value. Cap long lists with a limit, pages or a scroll area.

## What the sandbox blocks

| Blocked                                                                                                    | Use instead                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fetch` to Metabase or to any origin outside the app's `allowed_hosts`; `XMLHttpRequest`; `WebSocket`      | The data hooks for Metabase; _External APIs_ for anything else.                           |
| `alert`, `confirm`, `prompt`                                                                               | A modal in your own tree.                                                                 |
| `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`                                           | Nothing persists across reloads; persist through an action (`data-app-actions`).          |
| `window.open`, `history.pushState`, `history.replaceState`                                                 | `useDataAppLocation().navigate`; `<a target="_blank" rel="noopener">` for external links. |
| `navigator.clipboard`, `execCommand("copy")`                                                               | `await copy(text)` in a user event — write-only, there's no paste.                        |
| `navigator.geolocation` and other device APIs                                                              | Nothing.                                                                                  |
| Key, input, composition and clipboard listeners (`keydown`, `paste`, `input`, …) on `window` or `document` | A React handler (`onKeyDown`, `onPaste`, …) on your own element.                          |

**External APIs.** A raw `fetch` reaches only the origins in the app's `allowed_hosts`, exact or with a `*.` subdomain wildcard: `mb data-app update <slug> --body '{"allowed_hosts":["https://api.example.com"]}'`. The preview reads the `allowed_hosts:` list in `data_app.yaml` beside `package.json`, the app's exported manifest: refresh it by exporting and pulling the export branch (`data-app`, _Build and publish_, step 1), never by writing it. Then restart `npm run dev`. Never list the Metabase URL. In Metabase the same list governs `<iframe src>` and native `<form action>` submits, and the target must allow framing; the preview blocks both. Use `<form onSubmit>` with `preventDefault`: a native submit navigates the app away.

## Layout

- The root element gets `minHeight: "100vh"` (plus `boxSizing: "border-box"` with padding) and the page background; never `height`. Regions that reach the bottom, such as a sidebar, go in a flex-column root with `flex: 1`. Check the emptiest screens — loading, empty, a lone KPI — since they render shortest.
- SDK questions don't size to their parent: pass `height` and `width` to the component that draws (`StaticQuestion`, `InteractiveQuestion`, or `InteractiveQuestion.QuestionVisualization`) — the height actually left in its panel, or `height="100%"` in a fixed-height box. A KPI needs little: about `120` for a `scalar`, more for a `smartscalar`'s comparison or a `gauge`.
- Don't wrap an SDK question in `overflow: hidden`, hover transforms or hover-driven layout shifts: its menus and tooltips need stable geometry.

## Theme

`src/theme.ts`, passed as `providerProps.theme`, is the only way to style SDK components, one theme for the whole app; it never styles your own UI (inline styles or CSS modules).

| Key                                                    | Rule                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `colors.brand`                                         | The app's accent.                                                                                                                        |
| `colors["brand-hover"]`, `colors["brand-hover-light"]` | A light tint (`#EAF4FF` for a blue brand), never the saturated brand.                                                                    |
| `colors.charts`                                        | All 8 slots, starting with `brand`, vivid and distinct — never pale tints, which can color labels. An empty slot keeps Metabase's color. |
| `colors.background`, `colors["background-secondary"]`  | The color of the SDK component's own container: `white` inside a white card.                                                             |
| `colors["text-primary"]`, `-secondary`, `-tertiary`    | Contrast with `background`; set them whenever you set it. Missing contrast is the "invisible chart labels" bug.                          |
| `colors.positive`, `colors.negative`, `fontFamily`     | Up and down in trends and changes; the SDK's typeface. A `text-hover` must contrast with both brand-hover colors in open menus.          |

**Error state.** A question that can't load shows Metabase's neutral error. To match the app, add an `errorComponent` to `providerProps` — it replaces the error of every SDK component, so keep the wording generic, render its `message` (a `ReactNode`) as it is, and use no data hooks in it:

```tsx
import type { SdkErrorComponentProps } from "@metabase/embedding-sdk-react";

export function AppError({ message }: SdkErrorComponentProps) {
  return <div style={{ padding: 16, color: "#6b7280" }}>{message}</div>;
}
// src/index.tsx: providerProps: { theme, errorComponent: AppError }
```

## SDK components

| Import                | For                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------- |
| `StaticQuestion`      | A chart, KPI or table without drill-through — the default.                              |
| `InteractiveQuestion` | One meant to be explored: drill-through, chart switching; pass `isSaveEnabled={false}`. |

Both take a question in the app's collection. Dashboards and the authoring components (`CreateQuestion`, `CreateDashboardModal`, saving from the editor) don't work in an app: its collection can't hold a dashboard, and an app can't save content.

## A Metabase chart or your own

Ask "can Metabase draw this at all?", never "which looks closer to the design?" — and decide per element, not per page.

- **Yes** — bar, line, area, combo, row, pie, scalar, smartscalar, gauge, progress, funnel, scatter, waterfall, boxplot, sankey, pivot, map, tables: render it with `useMetabaseQueryObject` and `StaticQuestion` (`data-app-data`). It keeps the instance's formatting, tooltips, theming and drill-through. Styling is never a reason to draw it yourself.
- **No**, or the user asked for a custom one — scorecards, timelines, calendar grids, one visual from several queries: draw it from `useMetabaseQuery` rows, with SVG or a chart library the app already has.
- A KPI is `scalar`, `smartscalar`, `gauge` or `progress` — on a question filtered at runtime to one bucket, `scalar` (a `smartscalar` loses its comparison); put what Metabase doesn't draw (a caption, stars) beside it.
- `InteractiveQuestion`: pass `isSaveEnabled={false}`, and `title={false}` in a panel with its own heading. Children replace its layout: `<InteractiveQuestion card={card}><InteractiveQuestion.QuestionVisualization height={360} /></InteractiveQuestion>` is the chart alone.

**Visualization settings.** Add `visualizationSettings` only for a change the user asked for, or `scalar.field` on a KPI whose first column isn't the number. Their keys are a question's `visualization_settings` keys — the `visualization` skill lists them — and the installed types decide what's legal: `rg -n "<key>|declare type .*VisualizationSettings" node_modules/@metabase/embedding-sdk-react/dist/index.d.ts`, never the whole file, never from memory. Keep them few: keys such as `graph.dimensions`, `pie.metric` and `column_settings` name result columns and break when the question changes.

- A `table` with two breakouts and one aggregation renders as a pivot when a breakout has at most 16 values; `{ "table.pivot": false }` keeps one row per group.
- A scalar shows the first column: with a key or breakout column first (a date on a month question), point it at the number with `{ "scalar.field": "avg_rating" }`.
- A header: `column_settings: { '["name","approvers"]': { column_title: "Approvers" } }`.

## Pages

No router library — it calls `history.pushState`, which the sandbox blocks. Wrap the app once in `<DataAppRouter>`, link with `<DataAppLink to="/customers/42">` (an `<a href>` that takes the usual anchor props), and read `{ pathname, navigate }` from `useDataAppLocation()`. There's no `useParams`: match `pathname` yourself.

```tsx
const TABS = [
  { path: "/", label: "Overview", render: () => <Overview /> },
  { path: "/customers", label: "Customers", render: () => <Customers /> },
];
// `/` and any unknown path open the first tab
const activeTab = (pathname: string) =>
  TABS.find((tab) => tab.path !== "/" && pathname.startsWith(tab.path)) ?? TABS[0];

function Page() {
  const { pathname } = useDataAppLocation();
  const customerId = pathname.match(/^\/customers\/(\d+)$/)?.[1];
  return customerId ? <CustomerDetail id={Number(customerId)} /> : activeTab(pathname).render();
}
// nav: <DataAppLink to={tab.path} aria-current={tab === activeTab(pathname) ? "page" : undefined}>
// App: <DataAppRouter><Nav /><Page /></DataAppRouter>
```

Metabase mirrors each route to `/apps/<slug>/<path>`, and a reload there opens that page. A middle-click opens a new tab only in the preview; in Metabase that tab shows "This data app can't be opened directly." Check in the preview: reload on a sub-path, then on `/` — the first tab shows, marked selected.

## Before handoff

`npm run dev` only transpiles: run `npm run typecheck` after every round of edits and fix what it reports, and report the result, errors grouped by cause. Search the changed files and fix what turns up: `card={{` (every `card` comes from `useMemo`), `row[0]` and `as unknown as` (rows are keyed by column name), `<select` for a list from a question (`data-app-filters`), `type="date"` and `new Date("` (a date string parsed as UTC) in a date filter, `* 100` and `%`. Pass the tests (`data-app-testing`, _Before handoff_) with `npm run dev` running, read the diagnostics feed right after the e2e run, which mounts every panel, then build and publish (`data-app`, _Build and publish_).
