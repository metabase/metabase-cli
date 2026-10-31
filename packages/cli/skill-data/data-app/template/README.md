# Data app

A Metabase data app: a single-bundle React app, built with the Embedding SDK,
that Metabase serves at `/apps/<slug>`. Build and change it with a coding agent
and the `mb` data-app skills.

## Install

Install the SDK tag matching the Metabase instance first, then the rest.
`<major>` is 66 for a version tag v1.66.x (`mb auth status --profile <name> --json | jq -r .version.tag`);
`package.json` asks for any version, which would install `latest`.

```bash
npm install @metabase/embedding-sdk-react@<major>-beta
npm install
```

## Commands

In the app:

```bash
npm run dev         # preview at http://localhost:5174, in the sandbox Metabase runs apps in
npm run typecheck   # type-checks src/ and vite.config.ts
npm run build       # builds dist/index.js, the app's bundle
```

From the repository root:

```bash
mb data-app generate-schema <slug> --profile <name>   # src/metabase.schema.ts: the Library's tables and metrics
mb data-app generate-queries <slug> --profile <name>  # the questions of src/metabase.queries.ts, as collection files
mb data-app generate-actions <slug> --profile <name>  # the actions of src/metabase.actions.ts, as collection files
mb nano-id --count <n>               # entity IDs for new questions and actions
```

The app ships through git: commit `data_apps/<slug>/`, `dist/index.js`
included, with the files `generate-queries` and `generate-actions` write under
`collections/data_apps/`, and push; the next git-sync import loads them.

`npm run dev` reads `DATA_APP_MB_URL` and `DATA_APP_MB_API_KEY` from
`.env.local` at the repository root; `.env.local.example` lists them.
