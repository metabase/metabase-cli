---
title: "mb upload"
summary: "Upload CSV files into Metabase."
---

# mb upload

Upload CSV files into Metabase.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

## mb upload csv

Upload a CSV file as a new table and model.

Creates a table, and a model over it, in the server's uploads database, and prints the new model id and table id. An admin sets that database and its schema in **Admin** > **Settings** > **Uploads**; without one, the upload fails.

```sh
mb upload csv [flags]
```

| Flag | Description |
| --- | --- |
| `--file <value>` | Path to the CSV/TSV file to upload (required). |
| `--collection <value>` | Target collection id, or 'root' (default: root). |

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

| Argument or flag | Description |
| --- | --- |
| `<id>` | Target table id. |
| `--file <value>` | Path to the CSV/TSV file to upload (required). |

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

| Argument or flag | Description |
| --- | --- |
| `<id>` | Target table id. |
| `--file <value>` | Path to the CSV/TSV file to upload (required). |

Examples:

```sh
mb upload replace 42 --file rows.csv
mb upload replace 42 --file rows.csv --json
```
