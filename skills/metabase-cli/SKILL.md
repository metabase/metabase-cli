---
name: metabase-cli
description: Drive a Metabase instance from the terminal via the `mb` CLI. Authenticate with named profiles; inspect databases (list, get, full metadata rollup, schemas, tables in a schema) and trigger manual schema sync / field-values rescan; inspect tables, fields; list/get/create/update/archive cards (questions, models, metrics) and run them as JSON/CSV/XLSX; list/get/create/update dashboards and patch dashcards; list/get/create collections and traverse the hierarchy by id, entity_id, or "root"/"trash" (with items and recursive tree); list/get/create/update/archive native query snippets, segments, and measures; author/update/run transforms and schedule transform-jobs; read/update settings; search content (cards, dashboards, collections, transforms, metrics); manage Enterprise workspaces; git-sync to/from a git remote (status, dirty, import, export, branches, stash, add/remove a collection from sync). Use whenever the user wants to interact with a Metabase from the terminal — "log into metabase", "what profiles do I have", "list cards", "run card 42 as CSV", "create a transform", "list dashboards", "move a dashcard", "list collections", "what's in collection 4", "show the collection tree", "list snippets", "create a segment", "archive a measure", "search metabase for X", "spin up a workspace", "import the latest changes", "add a directory to git sync", "set a setting", "what schemas are in this database", "trigger a sync", "rescan field values", or anything hitting `mb <verb>`.
allowed-tools: Bash(mb:*), Bash(npx mb:*), Read, Write, Edit, AskUserQuestion
hidden: true
---

# metabase-cli

The official Metabase CLI (`mb`) drives a Metabase instance over its REST API.

Install: `npm i -g @metabase/cli`

## Start here

This file is a discovery stub, not the usage guide. Before running any `mb` command, load the actual workflow content from the CLI:

```bash
mb skills get core              # start here — auth, flag conventions, every command group
mb skills get core --full       # include all references for the deep dive
```

The CLI serves skill content bundled with the installed version, so instructions never go stale. The content in this stub cannot change between releases, which is why it just points at `mb skills get core`.

## Specialized skills

Load a specialized skill when the task falls outside one-shot CLI use:

```bash
mb skills get workspace         # Enterprise workspaces: create, provision, start, child credentials, diagnose
mb skills get transform         # author + run transforms (native SQL and MBQL 5), iterate on failures
mb skills get git-sync          # round-trip Metabase content to/from a git remote
```

Run `mb skills list` to see everything available on the installed version.

## Why mb

- Native `fetch`, typed Zod schemas, redacted secrets — the supported path for Metabase REST automation.
- One `--profile` per command targets staging, prod, a workspace child, whatever the user has configured.
- Output is shaped for agents: compact projection by default, `--full` / `--fields a,b.c` / `--json` / `--max-bytes` on every list/get.
- `mb __manifest` returns the canonical, machine-readable inventory of every command — name, args, output schema. Use it instead of scraping `--help`.
