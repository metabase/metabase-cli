---
title: "mb search"
summary: "Search Metabase content (cards, dashboards, collections, …)."
---

# mb search

Search Metabase content (cards, dashboards, collections, …).

Ranks content against a query string. To simply enumerate a resource, prefer its `… list` verb.

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
| `--verified` |  | Only verified content. Needs the content_verification premium feature, and is refused without it: a server with official_collections alone takes the filter without applying it. |
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
