---
title: "mb skills"
summary: "Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow."
---

# mb skills

Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow.

Without a command, `mb skills` runs `mb skills list`.

The CLI ships agent skills that document `mb` itself, in the layout Claude Code and `npx skills add` read. They are served from the installed CLI, so the instructions an agent reads always match the binary it runs. `mb skills list` names them.

## Skills and the server

A skill describes the newest Metabase and declares what it relies on: its frontmatter carries `requires: [<feature>, …]` (names from the client's feature table, such as `transforms` or `remoteSync`), and a passage inside a skill or one of its references sits between `<!-- requires: <feature>, … -->` and `<!-- /requires -->` markers, each on its own line.

`skills list` and `skills get` read the profile's cached server probe, with no request, and resolve both against it. A skill whose features the server lacks is left out and reported in the JSON envelope's `unavailable` array as `{ name, failure }`, where `failure` is the same `{ reason, detail, feature, since, tokenFeature, serverVersion }` a refused command carries; text mode reports each one on stderr. A section the server can use keeps its text and loses its markers; one it cannot use is removed. A marker inside a fenced code block is text.

Without a cached probe nothing is filtered, `unavailable` is `null`, the markers print as written, and text mode says why on stderr: no such profile, a profile never probed, or no probe for the URL `MB_URL` points at. `--unfiltered` skips the filter and prints the selected skills as written.

An unknown feature name, an unbalanced marker pair, or a marker between table rows is an error on every read, so a typo fails the gate rather than hiding a skill.

## Exit codes

`0` on success; a skill the server cannot use is reported, not refused. `2` for a missing or unknown skill name, an `MB_SKILLS_DIR` that is not a directory, an unknown feature in `requires`, or an unbalanced section marker. `1` for an unexpected I/O failure.

## mb skills list

List CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow. Skills the profile's server cannot use are left out; --unfiltered lists them too.

```sh
mb skills list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--unfiltered` |  | Print the selected skills as written, regardless of what the profile's server supports. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags).

Output schema: `mb schema skills list --output`.

Examples:

```sh
mb skills list
mb skills list --json
mb skills list --unfiltered
```

## mb skills get

Print one or more skills' `SKILL.md` content, as the profile's server can use it: a skill it lacks the features for is reported under `unavailable`, and a section it can't use is left out. Pass comma-separated names, or `--all` for every non-hidden skill. A named skill prints whole unless `--max-bytes` is given; `--all` keeps the default cap, which one long skill can fill, so pass `--max-bytes 0` to print every skill. `--unfiltered` prints the selection as written, regardless of the server. `--full` includes references and templates.

```sh
mb skills get [names] [flags]
```

| Argument | Description |
| --- | --- |
| `[names]` | Skill name (or comma-separated list). Omit to combine with --all for every non-hidden skill. |

| Flag | Default | Description |
| --- | --- | --- |
| `--all` |  | Every non-hidden skill. |
| `--unfiltered` |  | Print the selected skills as written, regardless of what the profile's server supports. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags).

Output schema: `mb schema skills get --output`.

Examples:

```sh
mb skills get core
mb skills get core --full
mb skills get git-sync,transform --json
mb skills get --all --json --max-bytes 0
mb skills get transform --unfiltered
```

## mb skills path

Print the absolute path to a skill (or all skills). Useful when an agent needs to read the SKILL.md or its references with the Read tool directly.

```sh
mb skills path [name] [flags]
```

| Argument | Description |
| --- | --- |
| `[name]` | Skill name (omit to list every non-hidden skill). |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags).

Output schema: `mb schema skills path --output`.

Examples:

```sh
mb skills path
mb skills path core
mb skills path core --json
```
