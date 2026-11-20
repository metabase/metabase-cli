---
title: "mb search"
summary: "Search Metabase content (cards, dashboards, collections, …)."
---

# mb search

Search Metabase content (cards, dashboards, collections, …).

Ranks content against a query string. To list every item of one kind, use its `list` command. The server applies the window: `--limit` and `--offset` travel with the request, and `--limit` defaults to 20, the one list command with a default of its own. `--verified` is refused before the request (exit 2) on a server without `content_verification`, because a server with `official_collections` alone takes the filter without applying it; a server with neither refuses the filter itself, and the error names the feature. With `--collection`, tables match only once published to the Library, and a transforms collection isn't searchable at all. With `--created-by`, collections, tables, databases, segments, transforms and indexed entities never match, since they record no creator.

```sh
mb search [query] [flags]
```

| Argument | Description |
| --- | --- |
| `[query]` | Search query string. |

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <value>` | `20` | Max items to return. |
| `--offset <value>` | `0` | Start at this item index; pass the previous run's next_offset to continue. |
| `-m, --models <value>` |  | Comma-separated model filter: card,dataset,metric,dashboard,collection,database,table,segment,measure,document,exploration,action,transform,indexed-entity. |
| `--archived` | `false` | Search only archived items (instead of only active ones). |
| `--db-id <value>` |  | Restrict to items on a given database id. |
| `--verified` |  | Only verified content (needs the content_verification premium feature). |
| `--collection <value>` |  | Restrict to one collection by id: its own row, subcollections and the content filed under them, never segments, measures or transforms (dashboard questions need --include-dashboard-questions). |
| `--created-by <value>` |  | Comma-separated user ids; matches items created by any of them (drops models with no creator). |
| `--search-native-query` |  | Also match native query text; narrows to cards, models, metrics, actions and transforms. |
| `--include-metadata` |  | Attach result_metadata to card, model and metric rows (needs --json --full, or --fields naming result_metadata). |
| `--include-dashboard-questions` |  | Also match questions saved into a dashboard (excluded by default). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema search --output`.

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
