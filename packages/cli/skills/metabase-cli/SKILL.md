---
name: metabase-cli
description: Drive a Metabase instance from the terminal via the `mb` CLI — auth, databases, cards, dashboards, transforms, queries, search, git-sync. Discovery entry; load the full guide with `mb skills get core`.
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
hidden: true
---

# metabase-cli

The official Metabase CLI (`mb`) drives a Metabase instance over its REST API.

Install: `npm i -g @metabase/cli`

## Start here

Before running any `mb` command, load the workflow content from the CLI:

```bash
mb skills get core    # auth, flag conventions, every command group
mb skills list        # everything available on the installed version
```

**Doing a whole job, not one command?** If the user wants an outcome — "make sense of my data", "build a data model", "go from raw data to a dashboard", "answer questions about my data", "be my data analyst", "set up analytics for X" — load the guided end-to-end skill instead and let it drive:

```bash
mb skills get data-workflow
```
