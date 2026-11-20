---
title: "mb content-translation"
summary: "Download or replace the content translation dictionary."
---

# mb content-translation

Download or replace the content translation dictionary.

## Access and Remote Sync

Both commands need an admin credential. The dictionary is independent of Remote Sync: importing or exporting a Git repository with [`mb git-sync import`](git-sync.md#mb-git-sync-import) or [`mb git-sync export`](git-sync.md#mb-git-sync-export) does not deploy it.

## mb content-translation download

Stream the complete content translation dictionary as CSV.

Streams the active dictionary to stdout with the server's CSV formatting. Redirect stdout to preserve it as a file that can be reviewed, versioned, or uploaded later. An empty dictionary downloads as Metabase's four-row sample dictionary, not a header-only file.

```sh
mb content-translation download [flags]
```

Shared flags: [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `contentTranslation` (token content_translation).

Output schema: `mb schema content-translation download --output`.

Examples:

```sh
mb content-translation download > metabase-content-translations.csv
mb content-translation download --profile prod > translations.csv
```

## mb content-translation upload

Replace the complete content translation dictionary from CSV.

Uploads one complete dictionary and replaces every active content translation on the server. Keep the canonical full CSV in version control and download the current dictionary before replacing it. Metabase accepts dictionaries up to 1.5 MiB.

```sh
mb content-translation upload [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--file <value>` |  | Path to the complete translation dictionary CSV (required). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `contentTranslation` (token content_translation).

Output schema: `mb schema content-translation upload --output`.

Examples:

```sh
mb content-translation upload --file translations.csv
mb content-translation upload --file translations.csv --profile prod --json
```
