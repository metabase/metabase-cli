---
name: metabase-cli
description: Drive a Metabase instance from the terminal via the `mb` CLI — auth, databases, cards, dashboards, transforms, queries, search, git-sync, Enterprise workspaces. Discovery entry; load the full guide with `mb skills get core`.
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
