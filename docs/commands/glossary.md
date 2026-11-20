---
title: "mb glossary"
summary: "Manage the Metabase glossary of business terms."
---

# mb glossary

Manage the Metabase glossary of business terms.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

## The glossary gives Metabot your business terms

The glossary is the instance-wide list of business terms and their definitions. Its entries are listed on the Glossary pages of Data Studio and the Data Reference, and Metabot gets them as context, so a definition written once shapes every answer that uses the term.

Every command runs on every supported server, and a server may restrict writes to admins and data analysts. There's no command to get one entry by id: use [mb glossary list](#mb-glossary-list) with `--search`.

## mb glossary list

List glossary entries in term order.

`--search` matches the term or the definition as a case-insensitive substring. Some servers read `%` and `_` in the text as SQL LIKE wildcards rather than literal characters. A blank `--search` is refused.

```sh
mb glossary list [flags]
```

| Flag | Description |
| --- | --- |
| `--search <value>` | Keep entries whose term or definition contains this text (case-insensitive). |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb glossary list
mb glossary list --search churn --json
```

## mb glossary create

Create a glossary entry, a term and its definition.

Pass `--term` and `--definition` together, or a JSON body with exactly those two keys. You can't use the flags with `--body` or `--file`, and a body piped on stdin isn't read while they're given. Neither field may be blank. Terms are unique.

```sh
mb glossary create [flags]
```

| Flag | Description |
| --- | --- |
| `--term <value>` | The term (used with --definition). |
| `--definition <value>` | The definition (used with --term). |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb glossary create --term "Churn" --definition "Customers lost in a period"
mb glossary create --body '{"term":"Churn","definition":"Customers lost in a period"}'
mb glossary create --file entry.json
```

## mb glossary update

Replace the term and definition of a glossary entry.

Both fields are replaced, so pass `--term` and `--definition` together, or a JSON body with exactly those two keys. You can't use the flags with `--body` or `--file`, and a body piped on stdin isn't read while they're given. Neither field may be blank.

```sh
mb glossary update <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Glossary entry id. |
| `--term <value>` | The term (used with --definition). |
| `--definition <value>` | The definition (used with --term). |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb glossary update 3 --term "Churn" --definition "Customers lost in a calendar month"
mb glossary update 3 --body '{"term":"Churn","definition":"Customers lost in a calendar month"}'
mb glossary update 3 --file entry.json
```

## mb glossary delete

Delete a glossary entry by id.

```sh
mb glossary delete <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Glossary entry id. |
| `--yes` | Skip confirmation. |

Examples:

```sh
mb glossary delete 3 --yes
mb glossary delete 3
```
