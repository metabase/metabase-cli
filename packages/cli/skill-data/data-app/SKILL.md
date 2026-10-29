---
name: data-app
description: Create, preview, publish and manage a Metabase data app — a React app Metabase serves at /apps/<slug> — create it, scaffold its project, run the dev preview and read its diagnostics feed, build and publish the bundle, turn it off, move it to another instance, delete it. Triggers — "build a data app", "make an internal tool in Metabase", "scaffold a data app", "publish my data app", "update the app", "the app is blank". Start here; the UI is in `data-app-ui`, questions and charts in `data-app-data`, filter controls in `data-app-filters`, writes in `data-app-actions`, tests in `data-app-testing`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Data apps

A **data app** is a React app built into one JavaScript bundle, which Metabase runs in a sandbox at `/apps/<slug>`. Each app has its own collection — **the app's collection** — and the questions and actions in it are everything the app can run. Flag conventions are in `core`.

The work, in order:

1. Create the app on the instance.
2. Scaffold the project in the synced git repository and install the SDK.
3. Give it data: questions over the Library's published tables and metrics in the app's collection, then `src/metabase.ts` (`data-app-data`); writes are `data-app-actions`.
4. Start the dev preview (_Dev preview_), then write the UI under `src/` (`data-app-ui`; filter controls in `data-app-filters`), with a test next to each component (`data-app-testing`).
5. Build, test, and push the source and the bundle together (_Build and publish_).

For every later change: first pass the checks in _An existing project_ (_Scaffold and install_), then regenerate `src/metabase.ts` if the app's collection changed, then build and publish (_Build and publish_). The bundle reaches Metabase only through git: a git-sync import loads the `dist/index.js` committed in the app's folder.

## Before you start

- Use an **admin** profile — only admins create apps and write the app's collection. `mb auth status --profile <name> --json | jq .user.isAdmin` prints `true` for one, and every command below takes that `--profile`; otherwise ask the user for an admin profile (`mb auth list`).
- Run `mb data-app list`. A failure means the instance has no data apps: stop and tell the user.
- The app ships through the instance's synced git repository. Check both ends first; if either fails, stop and tell the user which, changing nothing:
  - `mb git-sync status --profile <name> --json` reports `remote_configured: true` and `sync_type: "read-write"`.
  - The working folder is a clone of it: `git rev-parse --show-toplevel` succeeds, and `git remote -v` lists the repository `mb setting get remote-sync-url --profile <name>` names, in HTTPS or SSH form. That top level is `<repo>` below.
- Settle the **slug**, the `/apps/<slug>` URL: lowercase letters, digits and single dashes (`sales-overview`), at most 100 characters. If the app's purpose is unclear, ask "what's this app for?" and propose one.

## Create the app

```bash
mb data-app create --body '{"name":"sales-overview","display_name":"Sales overview"}' --json
```

`name` is the slug; `display_name` and `description` are optional. The app starts enabled, with an empty bundle, open to admins until a group is assigned. The answer's `resource_collection_id` is the id of the app's collection — note it. A `409` means the slug is taken: `mb data-app list` shows that app; reuse it or pick another slug.

## Scaffold and install

```bash
mb data-app scaffold <repo>/data_apps/sales-overview && cd <repo>/data_apps/sales-overview
```

`scaffold [dir]` takes a **directory**, not the slug: it copies the Vite + React + TypeScript template into a new or empty directory (the current one when omitted) and needs no server. The directory is `data_apps/<slug>/` in `<repo>`, where an export writes the app's `data_app.yaml` and bundle: an export leaves the source alone and an import ignores it, so the repository keeps the source with the app. `scaffold` needs an empty directory, so scaffold before the app's first export; for an app already in the repository, scaffold into a new directory and copy its files, dotfiles included (`cp -R <dir>/. data_apps/<slug>/`), in beside `data_app.yaml` and `dist/`; check `.gitignore` is there before `npm install`. Then install the SDK, then the rest:

```bash
npm install @metabase/embedding-sdk-react@<major>-beta   # <major>: 66 for a version tag v1.66.x (`mb auth status --profile <name> --json | jq -r .version.tag`)
npm install && npm run typecheck
```

Skip the SDK line when `package.json` already points it at a local build (`file:` or `link:`), and never install `latest`. A tag without a version number, such as `vLOCAL_DEV`, is a development build: ask the user which SDK build to install. The starter renders "Hello, data app". Build only in _Build and publish_, after the export: both write `dist/index.js`.

The template is the bundle contract. Don't edit `package.json` by hand, and never rewrite `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` or `src/index.tsx`: `vite.config.ts` stays `export default dataAppConfig()` (its only option is `port`), and `src/index.tsx` default-exports the `DataAppFactory` — change it only to add a `providerProps` key. Metabase and the dev preview each wrap the app in a `<MetabaseProvider>`, so the app never renders one.

**An existing project.** Before changing an app you didn't scaffold in this session, pass three checks:

- `vite.config.ts` is `export default dataAppConfig()` from `@metabase/embedding-sdk-react/data-app-dev/config`, with no local `config/` directory.
- `src/index.tsx` default-exports a `DataAppFactory` that takes no arguments and returns `{ component, providerProps? }`.
- `npm ls react react-dom` exits 0 and reports 19.x. A 19.x it marks `invalid` fails. This check applies whatever the instance or SDK version; to skip it, ask the user first.

Fix a failed React check yourself, before any other change: upgrade `react`, `react-dom`, `@types/react` and `@types/react-dom` to 19 until `npm run typecheck` passes and the diagnostics feed is clean (_Dev preview_); then publish (_Build and publish_). If either other check fails, stop: tell the user the project differs from the template, and ask whether to scaffold a fresh project and port the code over, or go on at their own risk.

## Dev preview

`npm run dev` serves the app at `http://localhost:5174` — or the next free port, in Vite's `Local:` line — through the same sandbox Metabase uses. An edit under `src/` rebuilds the bundle and remounts the app, resetting component state. The preview reads `DATA_APP_MB_URL` and an admin `DATA_APP_MB_API_KEY` from `.env.local` beside `package.json`. Create that key only on the user's yes: ask with `AskUserQuestion` ("Create an admin API key `data-app <slug> dev` for the preview? It goes in `.env.local` and is deleted at handoff."). On a no, the user fills in `.env.local` from `.env.local.example`. Write a new key straight into that file, never into the chat or the terminal:

```bash
( umask 077
  URL=$(mb auth status --profile <name> --json | jq -r .url)
  KEY=$(mb api-key create --profile <name> --body '{"name":"data-app <slug> dev","group_id":2}' --json | jq -r .unmasked_key)
  [ -n "$KEY" ] && [ "$KEY" != null ] && printf 'DATA_APP_MB_URL=%s\nDATA_APP_MB_API_KEY=%s\n' "$URL" "$KEY" > .env.local && echo written )
```

Group `2` is Administrators. Never print `.env.local`. Delete the key at handoff (`mb api-key list --profile <name>`, then `mb api-key delete <id> --yes --profile <name>`); the next session writes a new one. Metabase allows any localhost origin unless `MB_DISABLE_CORS_ON_LOCALHOST` is set, so a CORS error from the preview means it is: ask the user to unset it on this instance. Otherwise check `DATA_APP_MB_URL`.

### The diagnostics feed

Sandbox blocks, failed queries and uncaught errors never reach the terminal. With a preview tab open, read them from the feed:

```bash
curl -s "http://localhost:5174/__data-app/diagnostics?startEventId=0"
```

```jsonc
{
  "entries": [
    {
      "eventId": 31,
      "kind": "blocked-network",
      "alert": true,
      "summary": "Blocked fetch to api.example.com (not in allowed_hosts)",
      "detail": null,
      "hint": "…",
      "buildId": 7,
    },
  ],
  "clients": 1, // open preview tabs; 0 means nothing ran
  "buildId": 7, // the bundle running now
  "staleEntries": 164, // withheld: reported by a build already replaced
  "nextEventId": 32, // pass back as ?startEventId=
}
```

- `clients: 0` means no tab is open, so empty `entries` prove nothing.
- Before an edit, note `nextEventId`; after it, read again with that value as `startEventId`.
- The feed answers for the running bundle: entries from replaced builds are counted in `staleEntries`, and anything still broken reports again under the new `buildId` (`?includeStale=true` shows the withheld ones). A failed build doesn't advance `buildId` and doesn't reach the feed — read the `npm run dev` terminal.
- Quote `summary` as it is when you report it, and follow `hint` when there is one — except that you never add the Metabase URL to `allowed_hosts`, and you set `allowed_hosts` with `mb data-app update`, then export and pull (_Build and publish_, step 1), instead of editing `data_app.yaml`. A `frame-src` or `form-action` block can't be lifted in the preview (`data-app-ui`). The feed keeps the last 200 entries; `curl -X DELETE …/__data-app/diagnostics` clears it.

| `kind`                                | Fix                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `blocked-network`, `csp-violation`    | An external API: `data-app-ui`, _External APIs_. A `script-src` or `style-src` violation: bundle the asset instead. |
| `blocked-api`                         | Blocked in Metabase too: use the replacement in `data-app-ui`.                                                      |
| `sdk-call` with `alert: true`         | A Metabase request failed; `summary` names it.                                                                      |
| `sdk-call` for `/api/analytics-proxy` | Metabase's own usage analytics, not the app's: ignore it.                                                           |
| `error`                               | A bug; `detail` has the stack.                                                                                      |

## Build and publish

Build the bundle last, test it in the dev preview, then push it with the source in one commit:

1. Export the app's `data_app.yaml` and the questions and actions in its collection: `mb git-sync export` (`git-sync`, after its _Branch guard_), then in `<repo>` `git fetch`, `git switch <branch>` to the branch the instance tracks, `git pull --ff-only`.
2. Pass the tests (`data-app-testing`, _Before handoff_), then `npm run typecheck && npm run build`, which overwrites the exported `dist/index.js`.
3. With `npm run dev` running and a preview tab open, read the diagnostics feed (_Dev preview_) with every page mounted; fix what it reports and build again.
4. Commit `data_apps/<slug>/` — the source and `dist/index.js` together — and push.
5. `mb git-sync import --profile <name>`, whatever a cached `has-remote-changes` says. The new bundle is live at once.

A new app is on from the start; `mb data-app set-enabled <slug> false` turns it off, which only the user decides. An app turned off opens only in Data Studio → Data apps → the app → Overview; `/apps/<slug>` says "not found", for admins too. Give the user `<metabase-url>/apps/<slug>`.

A viewer needs one of their groups assigned to the app (otherwise "You don't have access"), which only the user can do (Data Studio → Data apps → the app → Permissions). A group reaches the app's collection and nothing more, so a viewer also needs data access to the tables its questions read.

## Pitfalls

| Symptom                                                             | Fix                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The app still runs the old bundle                                   | `dist/index.js` was built before the export's pull, or isn't in the pushed commit: build, commit, push, import.        |
| Blank app, `Bundle did not assign a function to __dataAppFactory__` | `src/index.tsx` must `export default` the factory and nothing else; otherwise the diagnostics feed has the real error. |
| "Failed to fetch the user, the session might be invalid."           | A bad key in `.env.local`, or CORS (_Dev preview_).                                                                    |
| A bundle of several MB                                              | `vite.config.ts` no longer uses `dataAppConfig()`, or the SDK isn't the `<major>-beta` tag.                            |
| "Invalid hook call"                                                 | A second React got bundled: nothing may add another `react` or `react-dom`.                                            |
| Drill-through popups don't open                                     | The app renders its own `<MetabaseProvider>`: remove it.                                                               |
| A rebuilt or reinstalled SDK still behaves like the old one         | Vite caches it: stop `npm run dev`, delete `node_modules/.vite`, start again.                                          |
| A viewer's query or action fails with 403                           | It reads something outside the app's collection, or the viewer lacks data access to its tables.                        |

## Change, move, delete

- **Turn off:** `mb data-app set-enabled <slug> false`. **Rename:** `mb data-app update <slug> --body '{"display_name":"…"}'` (also `description`, `allowed_hosts`).
- **Outdated:** an app Data Studio lists as _Outdated_ targets an older data-app contract: it won't open for anyone, and only admins see it, until it's migrated. Tell the user; don't change its code ad hoc.
- **Move to another instance:** the app, its collection and what the collection holds are git-synced content. `mb git-sync export` (`git-sync`) writes `data_apps/<slug>/` with the bundle, and the collection under `collections/data_apps/`; importing the repository on the other instance recreates them with the same entity IDs, so the same `src/metabase.ts` works there. The first import there creates the app on, like `create`, open to admins until the user assigns groups; later imports keep its on/off state. The import doesn't check that the questions' tables are published on that instance, so the Library content they read goes in the same export: flag the Library root once (`mb git-sync add-collection <library-id>`, `git-sync`), or its metrics, measures and segments stay out of the repository; a data action needs its database's toggle on there too. Never edit `data_app.yaml`; `dist/index.js` changes only through `npm run build` (_Build and publish_). The template's `.gitignore` keeps `node_modules/` and `.env.local` out. On a read-only synced instance only `set-enabled` works: creating, updating and deleting an app answer 403, and so does editing its collection; change it where it was built, push, and import there.
- **Delete:** confirm with the user, then `mb data-app delete <slug> --yes` — it removes the app, its bundle, its collection and the questions and actions in it. The project directory stays: the next export removes the app's `data_app.yaml`, bundle and collection files; after that export, switch and pull the same way, delete the source in `data_apps/<slug>/` in a commit of your own, push, and import.
