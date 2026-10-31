---
name: data-app
description: Create, preview, release and manage a Metabase data app — a React app Metabase serves at /apps/<slug> from the synced git repository — scaffold it in the repository, run the dev preview and read its diagnostics feed, generate its questions and actions, build, push and import it, turn it off, move it to another instance, delete it. Triggers — "build a data app", "make an internal tool in Metabase", "scaffold a data app", "publish my data app", "update the app", "the app is blank". Start here; the UI is in `data-app-ui`, questions and charts in `data-app-data`, filter controls in `data-app-filters`, writes in `data-app-actions`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Data apps

A **data app** is a React app built into one JavaScript bundle, which Metabase runs in a sandbox at `/apps/<slug>`. An app lives in the instance's synced git repository: `data_apps/<slug>/` holds its source, its `data_app.yaml` and its bundle `dist/index.js`, and `collections/data_apps/` its collection, with the questions and actions it runs. The app defines those in its source, as `defineQuery` exports in `src/metabase.queries.ts` and `defineAction` exports in `src/metabase.actions.ts`; `mb data-app generate-queries` and `mb data-app generate-actions` write them as the collection's files. Nothing about an app is created or changed in Metabase through the API: the app, its collection, its questions and actions exist on an instance once the repository is imported (`mb git-sync import`). Flag conventions are in `core`.

The work, in order:

1. Scaffold the app in the synced repository and install the SDK.
2. Give it data: fetch `src/metabase.schema.ts`, then define questions over the Library's published tables and metrics (`data-app-data`); writes are `data-app-actions`.
3. Start the dev preview (_Dev preview_), then write the UI under `src/` (`data-app-ui`; filter controls in `data-app-filters`).
4. Generate the collection, build, push and import (_Release_).

For every later change: first pass the checks in _An existing project_ (_Scaffold and install_), then change the source, then release (_Release_). The live app changes only through the import.

## Before you start

The app reaches Metabase only through the instance's synced git repository, so settle that first. If any check below fails, stop and tell the user which one, changing nothing:

1. **The instance syncs with git.** `mb git-sync status --profile <name> --json` reports `remote_configured: true`. A read-only instance is fine: the app is pushed to the repository and pulled in by an import.
2. **The working folder is that repository.** `git rev-parse --show-toplevel` succeeds, and one of `git remote -v` names the same repository as `mb setting get remote-sync-url --profile <name>`, however each spells it. That top level is `<repo>` below, checked out on the branch the instance tracks (`mb setting get remote-sync-branch --profile <name>`) and pulled (`git pull --ff-only`).
3. **You can push to it.** `git push --dry-run` from `<repo>` succeeds. Without a push the app never reaches the instance.

Then:

- Use an **admin** profile. `mb auth status --profile <name> --json | jq .user.isAdmin` prints `true` for one, and every command in the data-app skills that reaches Metabase takes that `--profile` (`scaffold` and `nano-id` take none); otherwise ask the user for an admin profile (`mb auth list`).
- Run `mb data-app list --profile <name>`. A failure means the instance has no data apps: stop and tell the user.
- **Only when the request needs the app to add, change or delete rows**, settle data actions on the database it writes to now, before designing anything (`data-app-actions`, _Data actions on the database_): the user may turn them on, or choose an app without writes. An app that only reads skips this, and never asks about data actions.
- Settle the **slug**, the `/apps/<slug>` URL: lowercase letters, digits and single dashes (`sales-overview`), at most 100 characters, and neither in `mb data-app list` nor under `<repo>/data_apps/`. If the app's purpose is unclear, ask "what's this app for?" and propose one.

The app's questions and actions refer to the Library's tables and metrics by their portable IDs, which resolve on this instance as they are: the Library needn't be in the repository to release here, only to move the app to another instance (_Change, move, delete_).

## Scaffold and install

```bash
cd <repo> && mb data-app scaffold sales-overview
```

From the repository root, `scaffold <slug>` copies the Vite + React + TypeScript template into `data_apps/<slug>/`, which must be missing or empty, and writes the app's `data_app.yaml` and its collection's file `collections/data_apps/data_app__<slug>.yaml`, with fresh entity IDs, and adds `.env.local` to `<repo>/.gitignore`. It needs no server. An app already in the repository is never scaffolded again: its entity IDs stay as they are.

`data_app.yaml` is the app's manifest. Edit `name` (the title Metabase shows: the one the user gave the app, or a short one that says what it's for), `description` and `allowed_hosts` (a YAML list of origins, `data-app-ui`, _External APIs_) in it directly; never change `entity_id`, `slug`, `path`, `version` or `collection`. Then install the SDK, then the rest:

```bash
cd data_apps/sales-overview
npm install @metabase/embedding-sdk-react@<major>-beta   # <major>: 66 for a version tag v1.66.x (`mb auth status --profile <name> --json | jq -r .version.tag`)
npm install && npm run typecheck
```

Install the SDK before the first `npm install`, which would otherwise install `latest` for the template's `*`. The starter renders "Hello, data app".

The template is the bundle contract. Don't edit `package.json` by hand, and never rewrite `vite.config.ts`, `tsconfig.json` or `src/index.tsx`: `vite.config.ts` stays `export default dataAppConfig()` (its only option is `port`), and `src/index.tsx` default-exports the `DataAppFactory` — change it only to add a `providerProps` key. Metabase and the dev preview each wrap the app in a `<MetabaseProvider>`, so the app never renders one.

**An existing project.** Before changing an app you didn't scaffold in this session, pass three checks:

- `vite.config.ts` is `export default dataAppConfig()` from `@metabase/embedding-sdk-react/data-app-dev/config`, with no local `config/` directory.
- `src/index.tsx` default-exports a `DataAppFactory` that takes no arguments and returns `{ component, providerProps? }`.
- `npm ls react react-dom` exits 0 and reports 19.x. A 19.x it marks `invalid` fails. This check applies whatever the instance or SDK version; to skip it, ask the user first.

Fix a failed React check yourself, before any other change: upgrade `react`, `react-dom`, `@types/react` and `@types/react-dom` to 19 until `npm run typecheck` passes and the diagnostics feed is clean (_Dev preview_); then release (_Release_). If either other check fails, stop: tell the user the project differs from the template, and ask whether to scaffold a fresh project and port the code over, or go on at their own risk.

## Dev preview

`npm run dev` serves the app at `http://localhost:5174` — or the next free port, in Vite's `Local:` line — under the restrictions Metabase puts on a data app (its CSP and blocked APIs), in the page itself rather than in an iframe. An edit under `src/` rebuilds the bundle and remounts the app, resetting component state. The preview runs each question from its definition and each action without saving it, against the instance whose IDs `src/metabase.schema.ts` holds, so that instance needs nothing of the app.

The preview reads `DATA_APP_MB_URL` and an admin `DATA_APP_MB_API_KEY` from `<repo>/.env.local`, which `<repo>/.gitignore` lists once the app is scaffolded: check the line is there before writing the file, and add it when it isn't. Create that key only on the user's yes: ask with `AskUserQuestion` ("Create an admin API key `data-app <slug> dev` for the preview? It goes in `.env.local` and is deleted at handoff."). On a no, the user fills in `<repo>/.env.local` from the app's `.env.local.example`. Write a new key straight into that file, never into the chat or the terminal:

```bash
( umask 077
  URL=$(mb auth status --profile <name> --json | jq -r .url)
  KEY=$(mb api-key create --profile <name> --body '{"name":"data-app <slug> dev","group_id":2}' --json | jq -r .unmasked_key)
  [ -n "$KEY" ] && [ "$KEY" != null ] && printf 'DATA_APP_MB_URL=%s\nDATA_APP_MB_API_KEY=%s\n' "$URL" "$KEY" > <repo>/.env.local && echo written )
```

Group `2` is Administrators. Never print `.env.local`. Delete the key at handoff, when you finish and give the app back to the user (`mb api-key list --profile <name>`, then `mb api-key delete <id> --yes --profile <name>`), and stop `npm run dev` with it: the preview can't reach Metabase once the key is gone. The next session writes a new one. Metabase allows any localhost origin unless `MB_DISABLE_CORS_ON_LOCALHOST` is set, so a CORS error from the preview means it is: ask the user to unset it on this instance. Otherwise check `DATA_APP_MB_URL`.

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
  "manifest": { "errors": [], "warnings": [], "restartRequired": false }, // checks of data_app.yaml
  "clients": 1, // open preview tabs; 0 means nothing ran
  "buildId": 7, // the bundle running now
  "staleEntries": 164, // withheld: reported by a build already replaced
  "nextEventId": 32, // pass back as ?startEventId=
  // also connection, sessionId, lastReportAt and lastRebuildAt, for diagnosing the feed itself
}
```

- `clients: 0` means no tab is open, so empty `entries` prove nothing. The preview page's Diagnostics button shows the same entries; its being there doesn't mean anything is wrong. Open the preview URL in your browser tool; without one, ask the user to open it and keep the tab open while you read the feed. The preview serves its page only to a browser (`Accept: text/html`), so a bare `curl` of it answers 404: probe the feed instead.
- `manifest` checks `data_app.yaml`: its `errors` need fixing like entries, and `restartRequired: true` means restart `npm run dev`. Its `warnings` too, except that a missing `dist/index.js` is expected until you build at release.
- Before an edit, note `nextEventId`; after it, read again with that value as `startEventId`.
- The feed answers for the running bundle: entries from replaced builds are counted in `staleEntries`, and anything still broken reports again under the new `buildId` (`?includeStale=true` shows the withheld ones). A failed build doesn't advance `buildId` and doesn't reach the feed — read the `npm run dev` terminal.
- Quote `summary` as it is when you report it, and follow `hint` when there is one — except that you never add the Metabase URL to `allowed_hosts`. An origin goes in `allowed_hosts` in `data_app.yaml`, then restart `npm run dev`. A `frame-src` or `form-action` block can't be lifted in the preview (`data-app-ui`). The feed keeps the last 200 entries; `curl -X DELETE …/__data-app/diagnostics` clears it.

| `kind`                             | Fix                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `blocked-network`, `csp-violation` | An external API: `data-app-ui`, _External APIs_. A `script-src` or `style-src` violation: bundle the asset instead. |
| `blocked-api`                      | Blocked in Metabase too: use the replacement in `data-app-ui`.                                                      |
| `sdk-call` with `alert: true`      | A Metabase request failed; `summary` names it.                                                                      |
| `error`                            | A bug; `detail` has the stack.                                                                                      |

## Release

Build the bundle last, test it in the dev preview, then push it with the source and the collection in one commit:

1. On a read-write instance, `mb git-sync is-dirty --profile <name> --json`: when it reports unexported changes (a table just published to the Library, say), export them first (`git-sync`, its branch guard included), or the import refuses; then `git pull --ff-only` in `<repo>`.
2. In `<repo>`, `mb data-app generate-queries <slug> --profile <name>` and `mb data-app generate-actions <slug> --profile <name>`. They load the exports of `src/metabase.queries.ts` and of `src/metabase.actions.ts` with the app's Vite, so `npm install` runs in the app first, and each replaces its kind of file in `collections/data_apps/data_app__<slug>/`: one YAML file per question or action, named after its export in lowercase and carrying its `entityId`. A generated question shows as a table in Metabase whatever the app makes of it. Nothing changes in Metabase.
3. In the app, `npm run typecheck && npm run build`, which writes `dist/index.js`.
4. With `npm run dev` running and a preview tab open, read the diagnostics feed (_Dev preview_) with every page mounted; fix what it reports, then generate and build again.
5. Commit `data_apps/<slug>/` — the source, `package.json`, `package-lock.json`, `data_app.yaml` and `dist/index.js` — and `collections/data_apps/` together, and push.
6. `mb git-sync import --profile <name>`, whatever a cached `has-remote-changes` says. The bundle, questions and actions are live at once.

A production build runs the question or action each `entityId` names, so a bundle pushed without its collection's files fails where they're missing.

The first import creates the app on, open to admins until a group is assigned; later imports keep its on/off state. `mb data-app set-enabled <slug> false` turns it off, which only the user decides. An app turned off opens only in Data Studio → Data apps → the app → Overview; `/apps/<slug>` says "not found", for admins too. Give the user `<metabase-url>/apps/<slug>`.

A viewer needs one of their groups assigned to the app (otherwise "You don't have access"), which only the user can do (Data Studio → Data apps → the app → Permissions). A group reaches the app's collection and nothing more, so a viewer also needs data access to the tables its questions read.

## Pitfalls

| Symptom                                                             | Fix                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The app still runs the old bundle                                   | `dist/index.js` isn't in the pushed commit, or the push wasn't imported: build, commit, push, import.                                 |
| Works in the preview, a question or action fails in Metabase        | `generate-queries` or `generate-actions` didn't run after the last change, or the files weren't committed with the bundle: _Release_. |
| Blank app, `Bundle did not assign a function to __dataAppFactory__` | `src/index.tsx` must `export default` the factory and nothing else; otherwise the diagnostics feed has the real error.                |
| "Failed to fetch the user, the session might be invalid."           | A bad key in `<repo>/.env.local`, or CORS (_Dev preview_).                                                                            |
| A bundle of several MB                                              | `vite.config.ts` no longer uses `dataAppConfig()`, or the SDK isn't the `<major>-beta` tag.                                           |
| "Invalid hook call"                                                 | A second React got bundled: nothing may add another `react` or `react-dom`.                                                           |
| Drill-through popups don't open                                     | The app renders its own `<MetabaseProvider>`: remove it.                                                                              |
| An upgraded SDK still behaves like the old one                      | Vite caches it: stop `npm run dev`, delete `node_modules/.vite`, start again.                                                         |
| A viewer's query or action fails with 403                           | It reads a table not published to the Library on that instance, or the viewer lacks data access to its tables.                        |

## Change, move, delete

Every change below is a commit to `<repo>`, pushed and imported (_Release_).

- **Turn off:** `mb data-app set-enabled <slug> false`. **Rename:** `name` in `data_app.yaml` (also `description`, `allowed_hosts`); the app's collection keeps its name, `Data App: <slug>`.
- **Outdated:** an app Data Studio lists as _Outdated_ targets an older data-app contract: it won't open for anyone, and only admins see it, until it's migrated. Tell the user; don't change its code ad hoc.
- **Move to another instance:** import the repository there. The app, its collection, questions and actions keep their entity IDs, so the same bundle runs there. The import doesn't check that the questions' tables are published on that instance, so the Library content they read goes in the same repository: flag the Library root once (`mb git-sync add-collection <library-id>`, `git-sync`), or its metrics, measures and segments stay out of it; an action needs its database's actions toggle on there too. `dist/index.js` changes only through `npm run build`. The app's `.gitignore` keeps `node_modules/` out, and `<repo>/.gitignore` keeps `.env.local` out.
- **Delete:** confirm with the user, then delete `data_apps/<slug>/`, `collections/data_apps/data_app__<slug>.yaml` and `collections/data_apps/data_app__<slug>/` in a commit of your own, push, and import.
