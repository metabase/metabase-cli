---
title: "mb upgrade"
summary: "Upgrade the Metabase CLI itself to the latest published release."
---

# mb upgrade

Upgrade the Metabase CLI itself to the latest published release.

Reads the latest version from the npm registry's dist-tags and finds how the binary was installed: npm-global (with its package manager: npm, pnpm, yarn or bun), npm-local, npx, dev, or unknown. Only an npm-global install is upgraded in place, by running the matching install command after a confirmation; every other method prints what to do by hand. Without --yes, a run with no TTY never prompts and installs nothing. --registry changes only where the dist-tags are read: the install goes through your package manager and its own configured registry. Exits 0 when up to date or when it printed the command, 1 on a registry or install failure, 2 on a --to that is no semver, 130 when the prompt is cancelled.

```sh
mb upgrade [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--check` |  | Print update status without installing. |
| `-y, --yes` |  | Skip the confirmation prompt. |
| `--to <value>` |  | Target version (default: latest published); an older one downgrades. |
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
