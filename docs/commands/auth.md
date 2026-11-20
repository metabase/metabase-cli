---
title: "mb auth"
summary: "Authenticate against a Metabase instance."
---

# mb auth

Authenticate against a Metabase instance.

Without a command, `mb auth` runs `mb auth login`.

Agent skills:

- `mb skills get core`: authentication and named profiles

## mb auth login

Log in to a Metabase instance for a profile.

Interactive login offers browser OAuth (recommended; Metabase v63+) or an API key — older servers fall back to the API key prompt automatically. Browser login opens Metabase, you sign in (password or SSO) and approve, and the CLI stores a refreshing access token. For CI/non-interactive use, supply an API key via --api-key (`--api-key -` reads it from stdin), piped stdin, or $MB_API_KEY (first non-empty wins); any of these skips the browser flow, even on a TTY. The URL comes from --url or $MB_URL, prompted when stdin is a TTY.

```sh
mb auth login [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--client-id <value>` |  | Pre-registered OAuth client id (when dynamic registration is disabled). |
| `--skip-verify` | `false` | Save without contacting the server. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema auth login --output`.

Examples:

```sh
mb auth login --url https://metabase.example.com
echo $MB_API_KEY | mb auth login --url https://metabase.example.com
pass show metabase | mb auth login --url https://metabase.example.com --api-key -
mb auth login --profile staging --url https://staging.example.com
```

## mb auth status

Show authentication status for a profile.

```sh
mb auth status [flags]
```

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags).

Output schema: `mb schema auth status --output`.

Examples:

```sh
mb auth status --json
mb auth status --profile staging
```

## mb auth list

List configured authentication profiles.

```sh
mb auth list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags).

Output schema: `mb schema auth list --output`.

Examples:

```sh
mb auth list
mb auth list --json
```

## mb auth logout

Clear stored credentials for a profile.

```sh
mb auth logout [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags).

Output schema: `mb schema auth logout --output`.

Examples:

```sh
mb auth logout --yes
mb auth logout --profile staging --yes
```
