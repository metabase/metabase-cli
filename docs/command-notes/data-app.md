## Data apps

A data app is a React app built into one JavaScript bundle, which Metabase serves in a sandbox at `/apps/<slug>`. It lives in the synced git repository under `data_apps/<slug>/`, and its questions and actions live in its collection's files under `collections/data_apps/`. Its content changes in Metabase only through an import of the repository ([mb git-sync import](git-sync.md#mb-git-sync-import)).
