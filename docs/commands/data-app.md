---
title: "mb data-app"
summary: "Manage Metabase data apps."
---

# mb data-app

Manage Metabase data apps.

Agent skills:

- `mb skills get data-app`: create, preview, build and publish a data app
- `mb skills get data-app-ui`: the app's UI: sandbox, layout, theme, charts, pages
- `mb skills get data-app-data`: the questions a data app runs, and its read hooks
- `mb skills get data-app-filters`: filter controls and date ranges
- `mb skills get data-app-actions`: writes: actions, forms and refresh
- `mb skills get data-app-testing`: unit tests with mocked queries and actions, and e2e tests

## mb data-app scaffold

Scaffold a data app in the synced repository, from its root.

Run from the root of the synced git repository. Copies the Vite + React + TypeScript template into `data_apps/<slug>/`, which must be missing or empty, and writes the app's `data_app.yaml` and its collection's file under `collections/data_apps/`, with new entity IDs, and adds `.env.local`, which holds the dev preview's API key, to the repository's `.gitignore`. It doesn't reach Metabase: the app exists there once the repository is imported. Before `npm install`, install the SDK tag `mb data-app sdk-version` answers for the instance (`npm install @metabase/embedding-sdk-react@<tag>`): the template's `*` installs `latest`, which may not build the app.

```sh
mb data-app scaffold <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Shared flags: [output](README.md#output-flags).

Output schema: `mb schema data-app scaffold --output`.

Agent skills:

- `mb skills get data-app`: the steps after scaffolding

Examples:

```sh
mb data-app scaffold sales-overview
```

## mb data-app sdk-version

Name the Embedding SDK tag that matches the instance's Metabase version.

Reads the instance's version afresh and the npm dist-tags of @metabase/embedding-sdk-react, and answers the most mature tag published for that Metabase major: its stable tag (`65-stable` for v1.65.x), or while the major has none, its beta, then its alpha tag. Fails on a development build, which no published SDK matches, and on a major npm has no tag for. Text output is the bare tag, so the install composes in a shell.

```sh
mb data-app sdk-version [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--registry <value>` |  | npm registry URL (default: https://registry.npmjs.org). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema data-app sdk-version --output`.

Agent skills:

- `mb skills get data-app`: installing the SDK in a scaffolded project

Examples:

```sh
mb data-app sdk-version
mb data-app sdk-version --json
TAG=$(mb data-app sdk-version --format text) && npm install "@metabase/embedding-sdk-react@$TAG"
```

## mb data-app list

List data apps.

Admins see every app, disabled and outdated ones included, with the id of its collection; other users see only the id, slug, name and state of the apps they can open.

```sh
mb data-app list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dataApps` (v65+, token data-apps).

Output schema: `mb schema data-app list --output`.

Examples:

```sh
mb data-app list
mb data-app list --json
```

## mb data-app get

Get a data app by slug.

Admins get any app, disabled ones included; other users get an enabled app they can open.

```sh
mb data-app get <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dataApps` (v65+, token data-apps).

Output schema: `mb schema data-app get --output`.

Examples:

```sh
mb data-app get sales-overview
mb data-app get sales-overview --json --full
```

## mb data-app generate-schema

Write a data app's src/metabase.schema.ts, from the repository root.

Run from the root of the synced git repository. Metabase generates the Library's published tables, with their fields, segments and measures, and the Library's metrics, by numeric ID; `defineQuery` and `defineAction` definitions in `src/metabase.queries.ts` and `src/metabase.actions.ts` are written against it. The IDs are this instance's, so the dev preview runs against it; a production build runs the questions and actions by entity ID. Fetch it again after publishing tables or changing their metadata.

```sh
mb data-app generate-schema <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Shared flags: [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dataApps` (v65+, token data-apps).

Output schema: `mb schema data-app generate-schema --output`.

Agent skills:

- `mb skills get data-app-data`: defining the app's questions and actions

Examples:

```sh
mb data-app generate-schema sales-overview
```

## mb data-app generate-queries

Write a data app's questions as its collection's files, from the repository root.

Run from the root of the synced git repository, after `npm install` in the app. Loads the `defineQuery` exports of the app's `src/metabase.queries.ts`, has Metabase build the question of each, named after its export and with its `entityId`, and replaces the question files of the app's collection under `collections/data_apps/` with them, leaving its action files alone. Nothing changes in Metabase until the repository is imported.

```sh
mb data-app generate-queries <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Shared flags: [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dataApps` (v65+, token data-apps).

Output schema: `mb schema data-app generate-queries --output`.

Agent skills:

- `mb skills get data-app-data`: the questions the app defines

Examples:

```sh
mb data-app generate-queries sales-overview
```

## mb data-app generate-actions

Write a data app's actions as its collection's files, from the repository root.

Run from the root of the synced git repository, after `npm install` in the app. Loads the `defineAction` exports of the app's `src/metabase.actions.ts`, has Metabase build the implicit action of each, named after its export and with its `entityId`, and replaces the action files of the app's collection under `collections/data_apps/` with them, leaving its question files alone. Nothing changes in Metabase until the repository is imported.

```sh
mb data-app generate-actions <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Shared flags: [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dataApps` (v65+, token data-apps).

Output schema: `mb schema data-app generate-actions --output`.

Agent skills:

- `mb skills get data-app-actions`: the actions the app defines

Examples:

```sh
mb data-app generate-actions sales-overview
```

## mb data-app set-enabled

Enable or disable a data app.

A new app is enabled, served to admins and the groups assigned to it; disable it to take it down. A disabled app opens only in Data Studio (Data apps → the app → Overview), and /apps/&lt;slug> says not found, admins included.

```sh
mb data-app set-enabled <slug> <enabled> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |
| `<enabled>` | true to enable the app, false to disable it. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dataApps` (v65+, token data-apps).

Output schema: `mb schema data-app set-enabled --output`.

Agent skills:

- `mb skills get data-app`: turn an app off

Examples:

```sh
mb data-app set-enabled sales-overview false
mb data-app set-enabled sales-overview true
```
