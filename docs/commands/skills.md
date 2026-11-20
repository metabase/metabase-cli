---
title: "mb skills"
summary: "Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow."
---

# mb skills

Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow.

Without a command, `mb skills` runs `mb skills list`.

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

Print one or more skills' SKILL.md content, as the profile's server can use it: a skill it lacks the features for is reported under `unavailable`, and a section it cannot use is left out. Pass comma-separated names, or --all for every non-hidden skill. A named skill prints whole unless --max-bytes is given; --all keeps the default cap. --unfiltered prints the selection as written, regardless of the server. --full includes references and templates.

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
mb skills get --all --json
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
