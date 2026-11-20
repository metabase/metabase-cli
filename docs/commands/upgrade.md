---
title: "mb upgrade"
summary: "Upgrade the Metabase CLI itself to the latest published release."
---

# mb upgrade

Upgrade the Metabase CLI itself to the latest published release.

```sh
mb upgrade [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--check` |  | Print update status without installing. |
| `-y, --yes` |  | Skip the confirmation prompt. |
| `--to <value>` |  | Target version (default: latest published). |
| `--registry <value>` |  | npm registry URL (default: https://registry.npmjs.org). |

Shared flags: [output](README.md#output-flags).

Output schema: `mb schema upgrade --output`.

Examples:

```sh
mb upgrade
mb upgrade --check
mb upgrade --check --json
mb upgrade --yes
mb upgrade --to 0.1.2
```
