---
title: "mb skills"
summary: "Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow."
---

# mb skills

Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow.

Without a command, `mb skills` runs `mb skills list`.

Every command on this page takes the [output](README.md#output-flags) and [list](README.md#list-flags) flags.

The CLI ships agent skills that document `mb` itself, in the layout Claude Code and `npx skills add` read. They're served from the installed CLI, so the instructions an agent reads always match the binary it runs. `mb skills list` names them.

## Skills follow the server's features

A skill describes the newest Metabase. Its frontmatter can list the features it needs (`requires: [transforms, …]`, names from the client's feature table), and a passage can sit between `<!-- requires: <feature>, … -->` and `<!-- /requires -->` markers, each on its own line.

`skills list` and `skills get` filter against the profile's cached server probe, with no request. A skill the server can't use is left out and listed in the JSON envelope's `unavailable` array as `{ name, failure }`, where `failure` has the shape a refused command's error carries; text mode reports it on stderr. A passage the server can use keeps its text and loses its markers, and one it can't use is removed.

Without a cached probe, nothing is filtered, `unavailable` is `null`, and the markers print as written; text mode says why on stderr (no such profile, a profile never probed, or no probe for the URL `MB_URL` points at). `--unfiltered` skips the filter.

An unknown feature name, an unbalanced marker pair, or a marker between table rows is an error on every read, so a typo fails instead of hiding a skill. A marker inside a fenced code block is plain text.

## Exit codes

`0` on success; a skill the server can't use is reported, not refused. `2` for a missing or unknown skill name, an `MB_SKILLS_DIR` that isn't a directory, an unknown feature in `requires`, or an unbalanced section marker. `1` for an unexpected I/O failure.

## mb skills list

List CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow.

Skills the profile's server can't use are left out; `--unfiltered` lists them too.

```sh
mb skills list [flags]
```

| Flag | Description |
| --- | --- |
| `--unfiltered` | Print the selected skills as written, regardless of what the profile's server supports. |

Also takes the [profile](README.md#profile-flags) flags.

Examples:

```sh
mb skills list
mb skills list --json
mb skills list --unfiltered
```

## mb skills get

Print one or more skills' `SKILL.md` content.

Pass comma-separated names, or `--all` for every non-hidden skill. A skill the profile's server can't use is reported under `unavailable`, and a section it can't use is left out; `--unfiltered` prints the selection as written. A named skill prints whole unless you pass `--max-bytes`, but `--all` keeps the default cap, which one long skill can fill, so pass `--max-bytes 0` to print every skill. `--full` adds references and templates.

```sh
mb skills get [names] [flags]
```

| Argument or flag | Description |
| --- | --- |
| `[names]` | Skill name (or comma-separated list). Omit to combine with --all for every non-hidden skill. |
| `--all` | Every non-hidden skill. |
| `--unfiltered` | Print the selected skills as written, regardless of what the profile's server supports. |

Also takes the [profile](README.md#profile-flags) flags.

Examples:

```sh
mb skills get core
mb skills get core --full
mb skills get git-sync,transform --json
mb skills get --all --json --max-bytes 0
mb skills get transform --unfiltered
```

## mb skills path

Print the absolute path to a skill, or to every skill.

Use the path to read a skill's `SKILL.md` or its references from disk.

```sh
mb skills path [name] [flags]
```

| Argument | Description |
| --- | --- |
| `[name]` | Skill name (omit to list every non-hidden skill). |

Examples:

```sh
mb skills path
mb skills path core
mb skills path core --json
```
