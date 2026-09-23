---
name: metabase-cli
description: Build Metabase content (cards, dashboards, documents, segments, measures, transforms) by editing representation YAML files in a git repo, using the `mb` CLI to read warehouse metadata, validate the files, and save them to Metabase. Discovery entry; load the full guide with `mb skills get core`.
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
hidden: true
---

# metabase-cli

The Metabase CLI (`mb`) in file mode: you write Metabase content as YAML files in a git repo, and `mb` does the three things files can't.

```
mb metadata   read databases, tables, and fields (with ready-to-paste refs)
mb check      validate the repo's YAML against the representation schemas
mb save       check, commit, push, and import into Metabase
```

Install: `npm i -g @metabase/cli`

## Start here

Before running any `mb` command or writing any YAML, load the workflow and the format:

```bash
mb skills get core              # the metadata -> edit -> check -> save loop, auth, output
mb skills get representations   # where the spec and schemas live, folder layout, refs
mb skills list                  # every bundled skill
```
