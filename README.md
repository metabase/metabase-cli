# metabase-cli

Command-line client for Metabase. Authenticates against an instance with an API key and stores it securely on your machine.

## Install

Not yet published. Build from source:

```sh
bun install
bun run build
node dist/cli.mjs --help
```

The published binary will be `metabase`. Examples below use that name.

## Quick start

```sh
metabase auth login --url https://metabase.example.com
metabase auth status
```

## Authentication

Credentials are stored per-profile. The default profile is named `default`. Use `--profile <name>` to manage additional profiles.

### `metabase auth login`

Save credentials for a profile.

| Flag                | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `--url <url>`       | Metabase URL. Falls back to `METABASE_URL`, then prompts.  |
| `--api-key <value>` | API key. Visible in shell history — pipe on stdin instead. |
| `--profile <name>`  | Profile to write to (default: `default`).                  |
| `--skip-verify`     | Save without contacting the server.                        |

Resolution order for the API key: `--api-key` → piped stdin → `METABASE_API_KEY` → interactive prompt. Stdin is auto-detected when not a TTY.

```sh
echo "$MB_KEY" | metabase auth login --url https://m.example.com
metabase auth login --url https://m.example.com < key.txt
```

### `metabase auth status`

Show whether a profile is authenticated.

```sh
metabase auth status
metabase auth status --json
metabase auth status --profile staging
```

| Flag               | Description                              |
| ------------------ | ---------------------------------------- |
| `--profile <name>` | Profile to inspect (default: `default`). |
| `--json`           | Emit JSON. Auto-enabled on non-TTY.      |

### `metabase auth logout`

Clear stored credentials for a profile.

```sh
metabase auth logout --yes
metabase auth logout --profile staging --yes
```

| Flag               | Description                             |
| ------------------ | --------------------------------------- |
| `--profile <name>` | Profile to clear (default: `default`).  |
| `--yes`            | Skip confirmation. Required on non-TTY. |

## License

Manage the Metabase Enterprise license token.

### `metabase license set [token]`

Store a license token. Resolution order: positional → piped stdin → `METABASE_LICENSE_TOKEN` → interactive prompt. Stdin is auto-detected when not a TTY.

Common output flags (`--json`, `--format`, `--detail`, `--fields`, `--max-bytes`) are accepted; the result payload is rendered through the standard output layer.

```sh
echo "$MB_LICENSE" | metabase license set
metabase license set < token.txt
```

### `metabase license status`

Show whether a license is stored. Does not reveal the value.

```sh
metabase license status
metabase license status --json
```

| Flag     | Description                         |
| -------- | ----------------------------------- |
| `--json` | Emit JSON. Auto-enabled on non-TTY. |

### `metabase license remove`

Clear the stored license.

```sh
metabase license remove --yes
```

| Flag    | Description                             |
| ------- | --------------------------------------- |
| `--yes` | Skip confirmation. Required on non-TTY. |

Common output flags (`--json`, `--format`, `--detail`, `--fields`, `--max-bytes`) are accepted; the result payload is rendered through the standard output layer.

## Transforms

CRUD on `/api/transform`. Bodies for `create` / `update` are JSON; resolution order: `--body` → `--file` → piped stdin (auto-detected when stdin is not a TTY).

### `metabase transform list`

```sh
metabase transform list
metabase transform list --json
```

### `metabase transform get <id>`

```sh
metabase transform get 1 --json
```

### `metabase transform create`

```sh
cat transform.json | metabase transform create
metabase transform create --file transform.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase transform update <id>`

```sh
metabase transform update 1 --body '{"name":"renamed"}'
```

Same `--body` / `--file` resolution as `create`. Stdin is auto-detected when not a TTY.

### `metabase transform delete <id>`

```sh
metabase transform delete 1 --yes
```

| Flag    | Description                             |
| ------- | --------------------------------------- |
| `--yes` | Skip confirmation. Required on non-TTY. |

### `metabase transform run <id>`

Trigger a manual run. Returns `{message, run_id}` and exits immediately. Pass `--wait` to poll until the run reaches a terminal status (`succeeded`, `failed`, `timeout`, `canceled`); the `final` field on the result holds the polled run state, and the command exits 1 if the final status is anything but `succeeded`.

```sh
metabase transform run 1
metabase transform run 1 --wait --json
```

| Flag              | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `--wait`          | Poll until the run reaches a terminal status.               |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`. |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.  |

## Transform jobs

CRUD on `/api/transform-job`. Bodies for `create` / `update` follow the same `--body` / `--file` / stdin pattern as transforms.

### `metabase transform-job list`

```sh
metabase transform-job list --json
```

### `metabase transform-job get <id>`

```sh
metabase transform-job get 1 --json
```

### `metabase transform-job create`

```sh
metabase transform-job create --body '{"name":"daily","schedule":"0 0 0 * * ?"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase transform-job update <id>`

```sh
metabase transform-job update 1 --body '{"schedule":"0 0 6 * * ?"}'
```

### `metabase transform-job delete <id>`

```sh
metabase transform-job delete 1 --yes
```

| Flag    | Description                             |
| ------- | --------------------------------------- |
| `--yes` | Skip confirmation. Required on non-TTY. |

## Environment variables

| Variable                 | Effect                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| `METABASE_URL`           | Default URL for `auth login` and config resolution.                            |
| `METABASE_API_KEY`       | Default API key (overrides interactive prompt; not stored).                    |
| `METABASE_PROFILE`       | Default profile when `--profile` is omitted. Falls back to `default`.          |
| `METABASE_LICENSE_TOKEN` | Default license token for `license set`.                                       |
| `METABASE_VERBOSE`       | When set to `1`, prints structured developer-detail JSON to stderr on failure. |

## Agent integration

### `metabase __manifest`

Hidden command that emits a machine-readable JSON manifest of every leaf command — name, description, examples, citty args, and the output Zod schema rendered as JSON Schema. Intended for agents that need typed capability discovery instead of scraping `--help`.

```sh
metabase __manifest | jq '.commands[].command'
```

The manifest schema (`Manifest`) is exported from `src/runtime/manifest.ts`.

## Exit codes

| Code  | Meaning                                                |
| ----- | ------------------------------------------------------ |
| `0`   | Success.                                               |
| `1`   | Verification or operation failed.                      |
| `2`   | Configuration error (invalid flag, missing TTY, etc.). |
| `130` | Interactive prompt cancelled (Ctrl+C).                 |
