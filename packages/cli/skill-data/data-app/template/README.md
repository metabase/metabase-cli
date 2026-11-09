# Data app

A Metabase data app: a single-bundle React app, built with the Embedding SDK,
that Metabase serves at `/apps/<slug>`. Build and change it with a coding agent
and the `mb` data-app skills.

## Install

Install the SDK tag matching the Metabase instance first, then the rest.
`mb data-app sdk-version` answers that tag from the instance's version, and
installing it writes the version it points at into `package.json` (`^0.65.1`),
in place of the `*` the template ships with or any version set before. A plain
`npm install` would install `latest` for the `*`, so the commands stop when
`sdk-version` fails.

```bash
TAG=$(mb data-app sdk-version --profile <name> --registry "$(npm config get registry)" --format text) &&
  npm install "@metabase/embedding-sdk-react@$TAG" &&
  npm install
```

## Commands

In the app:

```bash
npm run dev         # preview at http://localhost:5174, in the sandbox Metabase runs apps in
npm run typecheck   # type-checks src/ and the configs
npm run test:unit   # runs the unit tests next to the components
npm run test:e2e    # runs the Playwright specs in e2e/ against the preview
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

`npm run test:e2e` starts the preview, or reuses one already running; the first
run on a machine needs `npx playwright install chromium`. In CI, set
`DATA_APP_MB_URL` and `DATA_APP_MB_API_KEY` in the job's environment, against the
instance `src/metabase.schema.ts` was generated from.
