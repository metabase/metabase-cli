---
title: "mb upgrade"
summary: "Upgrade the Metabase CLI itself to the latest published release."
---

# mb upgrade

Upgrade the Metabase CLI itself to the latest published release.

Finds how the CLI was installed and the latest version on npm. Only an `npm-global` install (npm, pnpm, yarn or bun) is upgraded in place, after a confirmation; for an `npm-local`, `npx`, `dev` or `unknown` install, it prints what to do. Without `--yes`, a run with no TTY installs nothing. `--registry` changes only where the latest version is read: the install uses your package manager's own registry. Exits 0 when it upgrades, finds nothing to do, or prints what to do; 1 on a registry or install failure; 2 when `--to` isn't a valid semver version; and 130 when you cancel.

```sh
mb upgrade [flags]
```

| Flag | Description |
| --- | --- |
| `--check` | Print update status without installing. |
| `-y, --yes` | Skip the confirmation prompt. |
| `--to <value>` | Target version (default: latest published); an older one downgrades. |
| `--registry <value>` | npm registry URL (default: https://registry.npmjs.org). |

Takes the [output](README.md#output-flags) flags.

Examples:

```sh
mb upgrade
mb upgrade --check
mb upgrade --check --json
mb upgrade --yes
mb upgrade --to 0.1.2
```
