# Data app

A Metabase data app: a single-bundle React app, built with the Embedding SDK,
that Metabase serves at `/apps/<slug>`. Build and change it with a coding agent
and the `mb` data-app skills.

## Install

Install the SDK tag matching the Metabase instance first, then the rest.
`mb data-app sdk-version` answers that tag from the instance's version;
`package.json` asks for any version, which would install `latest`.

```bash
TAG=$(mb data-app sdk-version --profile <name> --registry "$(npm config get registry)" --format text) && npm install "@metabase/embedding-sdk-react@$TAG"
npm install
```

## Commands

```bash
npm run dev         # preview at http://localhost:5174, in the sandbox Metabase runs apps in
npm run typecheck   # type-checks src/ and vite.config.ts
npm run build       # builds dist/index.js, the app's bundle
mb data-app typed-schema <slug> --out src/metabase.ts   # the app's queries and actions
```

The bundle ships through git: commit `dist/index.js` (the file
`data_app.yaml` names) with the source and push; the next git-sync import
loads it.

`npm run dev` reads `DATA_APP_MB_URL` and `DATA_APP_MB_API_KEY` from
`.env.local`; `.env.local.example` lists them.
