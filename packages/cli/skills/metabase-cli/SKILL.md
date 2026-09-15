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

**Doing a whole job, not one command?** Higher-level data-engineering workflows — raw data to clean tables, the semantic layer, dashboards — live in the `rde` skill, which drives this CLI:

```bash
npx skills add metabase/agent-skills --skill rde -a claude-code
```

When it is installed, follow it; it loads the bundled skills it needs.
