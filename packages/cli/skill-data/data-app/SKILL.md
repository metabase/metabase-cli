---
name: data-app
description: Scaffold, build and publish a Metabase data app — a React bundle served at /apps/<slug> — with `mb data-app push`. Use to start, create or set up a data app, or to publish one; screens, queries and writes are in the data-app-* skills.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Create a Metabase Data App

A Metabase **data-app** is a single JS bundle that the host loads inside a Near Membrane sandbox and renders inside its own React tree. The scaffold is a Vite + React + TypeScript project: source under `src/`, a dev server that previews the app against a real Metabase **through the same Near Membrane sandbox + distortion rules Metabase uses in production** — so `npm run dev` behaves like production, including for third-party libraries the app bundles — and `npm run build` producing a single `dist/index.js`. (Because the sandbox runs a built bundle, a change rebuilds it and does a _soft reload_ — re-evaluates the bundle in the sandbox and remounts the app, keeping auth/SDK loaded — rather than hot-swapping modules; component state resets, but there's no full browser refresh.) The dev preview also shows a corner **⚠ Diagnostics** toolbar that captures runtime errors — including the sandbox's otherwise-opaque blocked-API messages — so failures surface instead of being swallowed. The same data is served as JSON at `http://localhost:5174/__data-app/diagnostics`, which is how _you_ read it (see "Reading the diagnostics feed" below) — you have a shell, not a browser, and these failures are invisible from the terminal otherwise.

**Publish the bundle with `mb data-app push`; keep the source in git.** Each app lives in its own directory `data_apps/<slug>/` of a git repository — its source, a `data_app.yaml` (slug, name, bundle path), and the built bundle at the `path` the manifest declares (`dist/index.js` by default). `mb data-app push` sends only the manifest and the bundle to Metabase, which serves the app at `/apps/<slug>`. The source is committed and pushed with plain git so it stays beside the app; Metabase never reads it.

**The scaffold ships with this skill in `template/`** (`mb skills path data-app` prints the skill's directory) — a Vite + React + TypeScript project. Step 3 copies it into the app directory; never write `package.json`, `vite.config.ts`, `tsconfig.json`, or `src/index.tsx` by hand.

## When to invoke this skill

- "scaffold a new data app" / "create a Metabase data app" / "set up a data-app project"
- "I want to build a data app" / any vague intent to author a data app
- Starting a fresh agent task that will produce a data-app bundle.
- Do **not** use this skill for an existing data-app project when the task is to
  build screens, use Metabase data, generate or refresh schema files, wire saved
  questions / tables / metrics / actions, add filters, or author data hooks.
  Use `data-app-semantic-layer` (queries, schema, filters), `data-app-actions`
  (writes), `data-app-routing` (pages) or `data-app-migrate` (an Outdated app).

## Step 1 — Pick the repository and check the server

- Ask which git repository holds the user's data apps and get its local path. If the instance has a repository connected for git sync (`mb data-app repo-status`), keeping apps there keeps every app's source in one place, but any repository works: Metabase receives apps through `mb data-app push`, not through git.
- Verify the path is a git working tree (it has a `.git`). It is the working directory below.
- `mb data-app list` must succeed: data apps need Metabase v65+ with the `data-apps` feature, and an admin profile (`mb auth status`).

## Step 2 — Name the app and create its directory

1. Settle on the app's **slug** before scaffolding — the `/apps/<slug>` URL — so it **must be dash-cased**: lowercase letters, numbers, and single dashes (`[a-z0-9]+(?:-[a-z0-9]+)*`), e.g. `sales-overview`. Anything else (uppercase, spaces, underscores) is rejected. If the purpose isn't clear yet, ask a one-line "what's this app for?" and propose a slug; confirm it.
2. Ensure `<repo>/data_apps/` exists; create it if missing.
3. Create `<repo>/data_apps/<slug>/`. **If it already exists**, treat it as an existing project (see below) — never overwrite without confirmation.

### Detecting an existing app

If `<repo>/data_apps/<slug>/` already holds a project, verify it matches the current `data-app-template`. Check **all** of:

1. `vite.config.ts` is a one-liner: `export default dataAppConfig()`
   (from `@metabase/embedding-sdk-react/data-app-dev/config`). There is **no**
   local `config/` directory: the whole bundle contract (externals/globals, the
   dev sandbox entry, CSS/SVG handling) lives inside that SDK config, not the
   scaffold. `dataAppConfig` takes only a curated set of overrides (currently just
   `port`); the contract plugin is always applied and can't be overridden.
2. `src/index.tsx` default-exports a `DataAppFactory` (type from
   `@metabase/embedding-sdk-react/data-app`) returning `{ component, providerProps? }`
   (no args).
3. `data_app.yaml` declares the same `version:` as this skill's
   `template/data_app.yaml` (a manifest without the line is version 1). A lower
   version is not drift but an outdated app: **Stop.** Migrating it is a
   separate task: `data-app-migrate`.

**All checks pass** → template-shaped. Ask: "Extend this app, or scaffold a new one under a different slug?" If extend → skip the copy step, edit `src/`. If new → pick a different slug and restart at Step 2.

**Any check fails** → not template-shaped (older scaffold or drift). **Stop.** Tell the user the structure differs from the current template, extending it risks breaking the bundle contract, and ask whether to (1) migrate it (`data-app-migrate`), (2) scaffold fresh under a new slug and port the code over, or (3) proceed anyway at their risk. Wait for the answer.

Never overwrite existing files without explicit confirmation.

## Step 3 — Copy the template into the app directory

```bash
APP_DIR="<repo>/data_apps/<slug>"
TEMPLATE="$(mb skills path data-app --json | jq -r '.data[0].path')/template"
cp -R "$TEMPLATE/." "$APP_DIR/"
mv "$APP_DIR/gitignore" "$APP_DIR/.gitignore"
```

The template's ignore file ships as `gitignore` because npm drops `.gitignore` from published packages; the `mv` restores it. A data app is a _subdirectory_ of the repository, never a nested `git clone` / `git init`. Everything below runs **inside `$APP_DIR`**.

The copy includes two root-level directories, `queries/` and `actions/`, each holding only a `README.md`. Keep both, even while empty: every query the app runs is a `defineQuery(...)` export in `queries/`, every action a `defineAction(...)` export in `actions/`, and the hooks refuse anything else at compile time. Read both READMEs before writing the first `useMetabaseQuery` / `useMetabaseQueryObject` / `useAction` call.

## Step 4 — Customize

Run everything from the app directory.

1. Set `package.json` `name` to the slug.
2. Pin the SDK to the data-apps tag (the template ships `*`); not `latest` or a `-stable` tag, which lack the data-app entrypoints:

   ```bash
   npm install @metabase/embedding-sdk-react@64-alpha
   ```

3. Give the SDK's build its credentials. `npm run build` synchronizes `queries/` and `actions/` with Metabase and reads `DATA_APP_MB_URL` and `DATA_APP_MB_API_KEY` from `<repo>/.env.local` (the repository root, one file for every app). `mb` uses its own profile and never needs this file. Ignore the file before it exists, create it from the example, and check it without printing it:

   ```bash
   ROOT="$(git rev-parse --show-toplevel)" && cd "$ROOT" &&
   { grep -qxF ".env.local" .gitignore 2>/dev/null || echo ".env.local" >> .gitignore; } &&
   { [ -f .env.local ] || cp "data_apps/<slug>/.env.local.example" .env.local; } &&
   ( source .env.local; [ -n "$DATA_APP_MB_URL" ] && [ "$DATA_APP_MB_URL" != mb_replace_me ] &&
     [ -n "$DATA_APP_MB_API_KEY" ] && [ "$DATA_APP_MB_API_KEY" != mb_replace_me ] ) &&
   echo "creds present" || echo "MISSING"; cd - >/dev/null
   ```

   On `MISSING`, ask the user to fill both values in `<repo>/.env.local` themselves: the Metabase URL and an admin API key (Admin → Authentication → API keys). **Never ask for the key in chat, and never print `.env.local` or its variables** — it may hold other secrets.

4. `npm install` (any package manager; the template ships no lockfile). Commit the lockfile.
5. **Edit `data_app.yaml`**, the manifest `mb data-app push` reads:

   ```yaml
   version: 1 # data-app contract version — leave as the template ships it
   name: Sales App # display name in the admin list
   slug: sales-app # the /apps/<slug> URL
   description: Pipeline health and quota attainment by region # optional, one sentence
   path: ./dist/index.js # bundle path relative to the app directory
   # allowed_hosts:       # optional — external origins the app may fetch/XHR
   #   - https://api.example.com
   ```

   - **`description`** — one short sentence shown under the name in the admin list (whitespace is folded; over 255 characters is refused). Delete the line if it adds nothing beyond the name.
   - **`version`** — the contract version the code targets. Never change it by hand: an app below the server's version is _Outdated_ — hidden from everyone but admins and refused when opened — until migrated one version at a time with `data-app-migrate`.
   - **`allowed_hosts`** — only for an app that calls an **external** API with `fetch`/`XHR`; the sandbox blocks all other egress. An origin (exact, or a `*.` subdomain wildcard) listed here opens in both `npm run dev` and Metabase. Never list the Metabase instance: Metabase data goes through the SDK's data hooks and `useAction`. Native `<form action>` submits and `<iframe>`/navigations obey the same list, and a native submit navigates the sandboxed frame away from the app — prefer `<form onSubmit>` with `preventDefault`.

## Step 5 — Verify the starter app

1. `npm run typecheck`, then `npm run build`.
2. `npm run dev` and open http://localhost:5174: the starter "Hello, data app" renders through the sandbox preview. If it hits CORS, add `http://localhost:5174` under Admin → Embedding → Embedded analytics SDK → CORS.
3. With the preview open, read the diagnostics feed once — the only place runtime failures reach you (`references/diagnostics.md`):

   ```bash
   curl -s "http://localhost:5174/__data-app/diagnostics?startEventId=0"
   ```

   Expect `clients: 1` and no entry with `"alert": true`; `clients: 0` means no preview tab is open, so an empty feed proves nothing.

4. Publish it (_Publish to Metabase_ below) when the user wants it in Metabase.

Stop here if the user only asked to create or set up a data app. Building screens on Metabase data is `data-app-semantic-layer`, and writes are `data-app-actions`.

**Leave `src/index.tsx`, `tsconfig.json` and `vite.config.ts` alone.** The build and dev setup is the SDK's `dataAppConfig()` (`export default dataAppConfig()` is the whole `vite.config.ts`); its only override is `port`, and there is no escape hatch for Vite plugins, aliases or `define`s — solve it in `src/`. Editing the factory in `src/index.tsx` silently breaks drill popups and routing.

**Run `npm run typecheck` after every round of edits** and before handing off: the dev server only transpiles, so type errors pass `npm run dev` unnoticed.

**Before handoff, check dependencies:** the SDK on the data-apps tag, and no date-picker library for date ranges (`DateRangePopover` from `@metabase/embedding-sdk-react/data-app` covers them).

## Source conventions

### 1. Write TSX

Plain ESM + TSX, normal package imports:

```tsx
// src/components/CustomerCard.tsx
import { StaticQuestion } from "@metabase/embedding-sdk-react";

type Customer = { name: string; questionId: number };

export default function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <article>
      <h3>{customer.name}</h3>
      <StaticQuestion questionId={customer.questionId} height={300} width="100%" />
    </article>
  );
}
```

### 2. Structure from the start

Default project layout once the starter app is extended:

```
queries/               (root level, beside package.json — NOT under src/)
│   └── orders.query.ts   (defineQuery exports; one file per topic)
actions/               (root level, beside package.json — NOT under src/)
│   └── orders.action.ts  (defineAction exports; one file per topic)
src/
├── index.tsx          (template — the factory; don't edit)
├── App.tsx            (routing + composition only)
├── theme.ts
├── metabase.data.ts   (generated schema — see the semantic-layer skill)
├── pages/             (one file per screen)
│   ├── Overview.tsx
│   └── CustomerDetail.tsx
├── components/        (shared UI)
│   └── Card.tsx
├── hooks/             (custom hooks that wrap a query export, never the query itself)
│   └── useCustomers.ts
├── lib/               (pure helpers / derivations)
│   └── format.ts
└── types/             (shared TS types)
    └── customer.ts
```

Vite bundles everything reachable from `src/index.tsx` into a single `dist/index.js` IIFE — the `src/` layout is purely for your own readability. `queries/` and `actions/` are not: `npm run build` synchronizes exactly those two root-level directories to Metabase, and the query and action hooks accept only the `defineQuery` / `defineAction` exports declared there. A query object written at a hook call, under `src/`, or spread from a definition does not compile (`Property 'definedWithDefineQuery' is missing`); the fix is to move it into `queries/` and import it, never a cast.

**If the app has multiple tabs (or any top-level screen switcher), select the default — leftmost / first — tab on initial load.** The app should never boot to a blank page, an empty shell, or a "nothing selected" state that waits for the user to click. Agents repeatedly forget this. For local-state tabs, initialize the active tab to the first one so the very first render shows it:

```tsx
const [active, setActive] = useState(TABS[0].id); // default = leftmost tab
```

If the tabs are instead backed by URL routes (multiple pages), the same rule applies via the router — see `data-app-routing` for making the base path `/` resolve to the default tab. Either way, verify by loading the app fresh: the leftmost tab's content is visible immediately and reads as selected.

**The build output is one self-contained `.js` file — nothing else.** The backend serves a single bundle, so there are no sidecar files: CSS is inlined into the JS, and every imported asset (images, fonts, SVGs-as-URLs) is base64-inlined as a data URI. So `import logo from "./logo.png"` / `import iconUrl from "./icon.svg"` give you a ready-to-use data-URI string, and SVGs can also be imported as React components with the **`?react`** suffix (built-in `svgr`): `import Icon from "./icon.svg?react"`. Everything gets baked into `dist/index.js` — just keep large binaries out, since inlining inflates the bundle. (If your editor doesn't recognize a `?react` import, add `declare module "*.svg?react";` to a `.d.ts` in `src/`.)

### 3. Import SDK values from the correct SDK entrypoint

The build externalizes React, the JSX runtimes, `@metabase/embedding-sdk-react`, and `@metabase/embedding-sdk-react/data-app` to sandbox globals in **both** production and `npm run dev` — in dev the sandbox entry endows them from the npm package, so the bundle runs identically in both. Just import from the entrypoints normally:

```tsx
// ✅ correct
import { StaticQuestion } from "@metabase/embedding-sdk-react";
import {
  DataAppRouter,
  DataAppLink,
  useMetabaseQuery,
} from "@metabase/embedding-sdk-react/data-app";

// ❌ wrong — no globalThis pattern; you'd be reading nothing
const { MetabaseProvider, StaticQuestion } = globalThis;
```

**Do NOT render `<MetabaseProvider>` in `App.tsx`.** The dev entry (served by the SDK's dev preset) and the production host both wrap your tree in a provider that lives in their own realm — wrapping inside the bundle would route the SDK's `setState`-via-listener paths through the Near Membrane sandbox and silently break drill popups, plugin init, and similar.

### 4. Import `react` normally too

The build externalizes `react` and `react-dom`, so plain imports resolve the same way in both modes — the production host and the dev sandbox both endow them as sandbox globals:

```tsx
import { useState, useEffect, useMemo } from "react";
```

**No `import React from "react"` needed in TSX files** — the template uses the automatic JSX runtime (`jsx: "react-jsx"` in `tsconfig.json`; `dataAppConfig()` includes the React plugin). The compiler injects the JSX-runtime imports it needs (`react/jsx-runtime` in production, `react/jsx-dev-runtime` in dev — both externalized and endowed by the sandbox). Just write JSX and named imports — that's it.

For React _types_ (e.g. `ComponentType`, `ReactNode`, `RefObject`), use named type imports rather than the `React.` namespace:

```ts
import type { ComponentType, ReactNode } from "react";
```

## App layout — fill the frame height

Metabase and `npm run dev` both give the bundle a full-height frame, but nothing between it and your root element sets a height — so an app shorter than the frame ends where its content ends, leaving its background, sidebar and footer in a short strip over bare white.

So the app's outermost element carries `minHeight: "100vh"` (plus `boxSizing: "border-box"` when it has padding) and paints the page background. `minHeight`, never `height` — taller content must still scroll. Regions that should reach the bottom (sidebar, sticky footer) go in a flex-column root with `flex: 1`. Check the emptiest screen — loading, empty state, a lone KPI — those are the ones that render short.

## SDK component sizing

SDK components do NOT auto-fit their parent — without `height`/`width` they render at their intrinsic size and overflow. Setting only the outer container or card height is not enough either; the height goes on the SDK component that owns the visualization:

- Chart only: pass `height` to `InteractiveQuestion.QuestionVisualization`.
- Default question layout with query bar: pass `height` to `InteractiveQuestion`.
- Static question: pass `height` to `StaticQuestion`.

Use the actual body height available to the chart. For example, if a card is 560px tall and has a 60px header, pass `height="500px"`.

```tsx
<div style={{ height: 360 }}>
  <StaticQuestion questionId={1} height="100%" width="100%" withChartTypeSelector={false} />
</div>
```

Do not wrap `InteractiveQuestion` or `StaticQuestion` in containers that clip or move on hover. Avoid `overflow: hidden`, hover transforms, and hover-driven layout shifts around embedded Metabase UI; popovers, menus, and chart tooltips need stable geometry and visible overflow.

## Publish to Metabase

1. `npm run build` — synchronizes `queries/` and `actions/` with Metabase, then writes the bundle at the manifest's `path`.
2. `mb data-app push data_apps/<slug>` — creates the app on the first push and updates it after; it is served at `/apps/<slug>`. Every later change is another build and push.
3. Commit and push the source with plain git from the repository root: `git add data_apps/<slug>` (source, `data_app.yaml`, lockfile, `resources_metadata.json`), `git commit`, `git push`.

Never trigger a git sync import (`mb git-sync import`, or **Pull changes** in Admin) to deliver an app: the bundle reaches Metabase only through `mb data-app push`, and importing the same app over a pushed one only creates conflicts. There is no separate deploy step either.

- **Disable** without deleting: `mb data-app update <slug> --body '{"enabled":false}'`.
- **Remove:** `mb data-app delete <slug> --yes` — also deletes the app's collection and permission group.
- **Who can see the data:** `mb data-app permission-warnings <slug> --user-ids <ids>` names users who miss a table the app reads.

## More

- `references/sdk-surface.md` — theme rules, a custom error UI, the SDK components an app can render, the APIs the sandbox blocks, and when to render a chart with Metabase rather than React.
- `references/diagnostics.md` — reading the dev preview's diagnostics feed.
- `references/pitfalls.md` — symptoms and fixes.
