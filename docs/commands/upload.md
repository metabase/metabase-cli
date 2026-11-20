---
title: "mb upload"
summary: "Upload CSV files into Metabase."
---

# mb upload

Upload CSV files into Metabase.

## mb upload csv

Upload a CSV file as a new table and model.

Uploads the CSV to the server's configured uploads database, creating a new table plus a model over it, and prints the new model id and table id. Requires an uploads database to be configured on the server (**Admin** > **Settings** > **Uploads**); the destination database and schema are set there, not per command. Pass `--collection` to place the model in a specific collection (defaults to `root`).

```sh
mb upload csv [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--file <value>` |  | Path to the CSV/TSV file to upload (required). |
| `--collection <value>` |  | Target collection id, or 'root' (default: root). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema upload csv --output`.

Examples:

```sh
mb upload csv --file data.csv
mb upload csv --file data.csv --collection 5
mb upload csv --file data.csv --json
```

## mb upload append

Append a CSV file's rows to an existing uploaded table.

Inserts the rows of the CSV into the table with the given id. The table must have been created by a CSV upload and the CSV columns must match.

```sh
mb upload append <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Target table id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--file <value>` |  | Path to the CSV/TSV file to upload (required). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema upload append --output`.

Examples:

```sh
mb upload append 42 --file more-rows.csv
mb upload append 42 --file more-rows.csv --json
```

## mb upload replace

Replace an existing uploaded table's rows with a CSV file.

Replaces the contents of the table with the given id with the rows of the CSV. The table must have been created by a CSV upload and the CSV columns must match.

```sh
mb upload replace <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Target table id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--file <value>` |  | Path to the CSV/TSV file to upload (required). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema upload replace --output`.

Examples:

```sh
mb upload replace 42 --file rows.csv
mb upload replace 42 --file rows.csv --json
```
