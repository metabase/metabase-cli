---
title: "Metabase CLI command reference"
summary: "Each mb command, with its arguments, flags, examples, and the Metabase features it needs."
---

# Metabase CLI command reference

Agent skills:

- `mb skills get core`: auth, conventions, and per-resource footguns
- `mb skills get data-workflow`: guided end-to-end: raw data → clean tables → metrics → answers → dashboards

## Commands

| Command | Description |
| --- | --- |
| [mb auth](auth.md) | Authenticate against a Metabase instance |
| [mb db](db.md) | Inspect and sync Metabase databases, and turn their data actions on or off |
| [mb table](table.md) | Manage Metabase tables |
| [mb field](field.md) | Manage Metabase fields |
| [mb upload](upload.md) | Upload CSV files into Metabase |
| [mb content-translation](content-translation.md) | Download or replace the content translation dictionary |
| [mb card](card.md) | Manage Metabase cards (questions, models, metrics) |
| [mb dashboard](dashboard.md) | Manage Metabase dashboards |
| [mb subscription](subscription.md) | Manage Metabase dashboard subscriptions (scheduled dashboard delivery) |
| [mb data-action](data-action.md) | Manage Metabase data actions |
| [mb data-app](data-app.md) | Manage Metabase data apps |
| [mb api-key](api-key.md) | Manage Metabase API keys |
| [mb alert](alert.md) | Manage Metabase question alerts (scheduled card delivery on a send condition) |
| [mb collection](collection.md) | Manage Metabase collections |
| [mb library](library.md) | Curate the Metabase Library — publish trusted tables to its Data collection |
| [mb document](document.md) | Manage Metabase documents |
| [mb glossary](glossary.md) | Manage the Metabase glossary of business terms |
| [mb transform](transform.md) | Manage Metabase transforms |
| [mb transform-job](transform-job.md) | Manage Metabase transform jobs |
| [mb transform-tag](transform-tag.md) | Manage Metabase transform tags |
| [mb transform-test](transform-test.md) | Manage transform tests — fixtures and expectations run against temp tables |
| [mb ci](ci.md) | Check a branch's transforms the way CI does |
| [mb setting](setting.md) | Inspect and update Metabase settings |
| [mb search](search.md) | Search Metabase content (cards, dashboards, collections, …) |
| [mb git-sync](git-sync.md) | Sync Metabase content with a git remote |
| [mb setup](setup.md) | Complete the initial Metabase setup wizard with a default user |
| [mb snippet](snippet.md) | Manage Metabase native query snippets |
| [mb segment](segment.md) | Manage Metabase segments |
| [mb measure](measure.md) | Manage Metabase measures |
| [mb dependency](dependency.md) | Trace what Metabase content depends on and what depends on it |
| [mb timeline](timeline.md) | Manage Metabase timelines (event annotations for time-series charts) |
| [mb timeline-event](timeline-event.md) | Manage events on Metabase timelines (list them with `mb timeline events`) |
| [mb eid](eid.md) | Translate Metabase entity ids (string EIDs) to numeric ids |
| [mb query](query.md) | Run, compile, or inspect an ad-hoc MBQL or native query |
| [mb schema](schema.md) | Print the schema of a command's JSON body or output |
| [mb uuid](uuid.md) | Mint random UUID v4 strings |
| [mb nano-id](nano-id.md) | Mint random NanoIDs, the entity IDs Metabase serializes content by |
| [mb upgrade](upgrade.md) | Upgrade the Metabase CLI itself to the latest published release |
| [mb skills](skills.md) | Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow. |

## Shared flags

Many commands take one or more of these flag sets. Each command names the sets it takes.

### Output flags

| Flag | Default | Description |
| --- | --- | --- |
| `--format <value>` | `auto` | auto \| json \| text. |
| `--json` |  | Shorthand for --format json. |
| `--full` |  | Return the full object (default: compact). |
| `--fields <value>` |  | Dot-paths, comma separated (mutually exclusive with --full). |
| `--max-bytes <value>` | `24576` | Output size cap; 0 disables. |

### Format flags

| Flag | Default | Description |
| --- | --- | --- |
| `--format <value>` | `auto` | auto \| json \| text. |
| `--json` |  | Shorthand for --format json. |

### List flags

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <value>` |  | Max items to return (default: as many as fit the output cap). |
| `--offset <value>` | `0` | Start at this item index; pass the previous run's next_offset to continue. |

### Profile flags

| Flag | Default | Description |
| --- | --- | --- |
| `-p, --profile <value>` |  | Named profile (default: 'default'). |

### Connection flags

| Flag | Default | Description |
| --- | --- | --- |
| `--url <value>` |  | Metabase URL, including any subpath the instance is served under (https://example.com/metabase). |
| `--api-key <value>` |  | API key. |
| `--skip-preflight` |  | Skip the client's version and license checks made before a request, and let the server answer. |
