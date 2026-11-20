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

## A data app lives in the synced repository

A data app is a React app built into one JavaScript bundle, which Metabase serves in a sandbox at `/apps/<slug>`. It lives in the synced git repository under `data_apps/<slug>/`, and its questions and actions live in its collection's files under `collections/data_apps/`. Its content changes in Metabase only through an import of the repository ([mb git-sync import](git-sync.md#mb-git-sync-import)).

## mb data-app scaffold

Scaffold a data app in the synced repository, from its root.

Copies the Vite + React + TypeScript template into `data_apps/<slug>/`, which must be missing or empty, writes the app's `data_app.yaml` and its collection's file with new entity IDs, and adds `.env.local` (the dev preview's API key) to `.gitignore`. It doesn't reach Metabase: the app exists there once you import the repository. Before `npm install`, install the SDK tag that `mb data-app sdk-version` names (`npm install @metabase/embedding-sdk-react@<tag>`), since the template's `*` installs `latest`, which may not build the app.

```sh
mb data-app scaffold <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Takes the [output](README.md#output-flags) flags.

Agent skills:

- `mb skills get data-app`: the steps after scaffolding

Examples:

```sh
mb data-app scaffold sales-overview
```

## mb data-app sdk-version

Name the Embedding SDK tag that matches the instance's Metabase version.

Returns the most mature tag of @metabase/embedding-sdk-react published for the instance's Metabase major: its stable tag (`65-stable` for v1.65.x), or, while it has none, its beta, then its alpha tag. Exits 2 on a development build (`vUNKNOWN`, `vLOCAL_DEV`, a `-SNAPSHOT` tag) and on a major with no tag on npm. JSON output carries `metabaseVersion`, `tag` and the SDK `version`; text output is the bare tag, for use in a shell. To read the registry `npm install` uses, pass `--registry "$(npm config get registry)"`.

```sh
mb data-app sdk-version [flags]
```

| Flag | Description |
| --- | --- |
| `--registry <value>` | npm registry URL (default: https://registry.npmjs.org). |

Takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

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

Admins see every app, disabled and outdated ones included, with its collection's id; other people see only the id, slug, name and state of the apps they can open.

```sh
mb data-app list [flags]
```

Takes the [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Needs `dataApps` (v65+, token data-apps).

Examples:

```sh
mb data-app list
mb data-app list --json
```

## mb data-app get

Get a data app by slug.

Admins get any app, disabled ones included; other people get an enabled app they can open.

```sh
mb data-app get <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Needs `dataApps` (v65+, token data-apps).

Examples:

```sh
mb data-app get sales-overview
mb data-app get sales-overview --json --full
```

## mb data-app generate-schema

Write a data app's src/metabase.schema.ts, from the repository root.

Metabase writes the Library's published tables, with their fields, segments and measures, and its metrics, by numeric ID, for the `defineQuery` and `defineAction` definitions to be written against. The IDs are this instance's, so the dev preview runs against it; a production build runs the questions and actions by entity ID. Run it again after you publish tables or change their metadata.

```sh
mb data-app generate-schema <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Takes the [profile](README.md#profile-flags) and [connection](README.md#connection-flags) flags.

Needs `dataApps` (v65+, token data-apps).

Agent skills:

- `mb skills get data-app-data`: defining the app's questions and actions

Examples:

```sh
mb data-app generate-schema sales-overview
```

## mb data-app generate-queries

Write a data app's questions as its collection's files, from the repository root.

Run it after `npm install` in the app. Loads the `defineQuery` exports of `src/metabase.queries.ts`, has Metabase build each one's question (named after the export, with its `entityId`), and replaces the question files of the app's collection with them. Action files stay as they are, and Metabase changes only when you import the repository.

```sh
mb data-app generate-queries <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Takes the [profile](README.md#profile-flags) and [connection](README.md#connection-flags) flags.

Needs `dataApps` (v65+, token data-apps).

Agent skills:

- `mb skills get data-app-data`: the questions the app defines

Examples:

```sh
mb data-app generate-queries sales-overview
```

## mb data-app generate-actions

Write a data app's actions as its collection's files, from the repository root.

Run it after `npm install` in the app. Loads the `defineAction` exports of `src/metabase.actions.ts`, has Metabase build each one's implicit action (named after the export, with its `entityId`), and replaces the action files of the app's collection with them. Question files stay as they are, and Metabase changes only when you import the repository.

```sh
mb data-app generate-actions <slug> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |

Takes the [profile](README.md#profile-flags) and [connection](README.md#connection-flags) flags.

Needs `dataApps` (v65+, token data-apps).

Agent skills:

- `mb skills get data-app-actions`: the actions the app defines

Examples:

```sh
mb data-app generate-actions sales-overview
```

## mb data-app set-enabled

Enable or disable a data app.

A new app is enabled, served to admins and the groups assigned to it; disable it to take it down. A disabled app opens only in Data Studio (**Data apps** > the app > **Overview**), and `/apps/<slug>` says not found, admins included.

```sh
mb data-app set-enabled <slug> <enabled> [flags]
```

| Argument | Description |
| --- | --- |
| `<slug>` | Data app slug (its /apps/&lt;slug> URL). |
| `<enabled>` | true to enable the app, false to disable it. |

Takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Needs `dataApps` (v65+, token data-apps).

Agent skills:

- `mb skills get data-app`: turn an app off

Examples:

```sh
mb data-app set-enabled sales-overview false
mb data-app set-enabled sales-overview true
```
