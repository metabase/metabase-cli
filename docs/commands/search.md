---
title: "mb search"
summary: "Search Metabase content (cards, dashboards, collections, …)."
---

# mb search

Search Metabase content (cards, dashboards, collections, …).

Ranks content against a query; to list every item of one kind, use its `list` command. `--limit` defaults to 20, unlike other list commands. `--verified` is refused before the request (exit 2) on a server without the `content_verification` token feature. With `--collection`, tables match only once they're published to the Library, and a transforms collection isn't searchable. With `--created-by`, collections, tables, databases, segments, transforms and indexed entities never match, since they record no creator.

```sh
mb search [query] [flags]
```

| Argument or flag | Description |
| --- | --- |
| `[query]` | Search query string. |
| `--limit <value>` | Max items to return. Default: `20`. |
| `--offset <value>` | Start at this item index; pass the previous run's `next_offset` to continue. Default: `0`. |
| `-m, --models <value>` | Comma-separated model filter: card,dataset,metric,dashboard,collection,database,table,segment,measure,document,exploration,action,transform,indexed-entity. |
| `--archived` | Search only archived items (instead of only active ones). |
| `--db-id <value>` | Restrict to items on a given database id. |
| `--verified` | Only verified content (needs the content_verification premium feature). |
| `--collection <value>` | Restrict to one collection by id: its own row, subcollections and the content filed under them, never segments, measures or transforms (dashboard questions need --include-dashboard-questions). |
| `--created-by <value>` | Comma-separated user ids; matches items created by any of them (drops models with no creator). |
| `--search-native-query` | Also match native query text; narrows to cards, models, metrics, actions and transforms. |
| `--include-metadata` | Attach result_metadata to card, model and metric rows (needs --json --full, or --fields naming result_metadata). |
| `--include-dashboard-questions` | Also match questions saved into a dashboard (excluded by default). |

Takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get core`: search vs. list

Examples:

```sh
mb search orders
mb search --models card,dashboard --limit 10 --json
mb search products --archived
mb search --collection 12 --created-by 3,7 --include-dashboard-questions --json
mb search revenue --search-native-query --include-metadata --full --json
```
