---
title: "mb auth"
summary: "Authenticate against a Metabase instance."
---

# mb auth

Authenticate against a Metabase instance.

Without a command, `mb auth` runs `mb auth login`.

Agent skills:

- `mb skills get core`: authentication and named profiles

## Profiles

Credentials are stored per profile. The default profile is named `default`; pass `--profile <name>` (`-p`) to log in to, inspect or clear another one, and to point any other command at it.

Profile metadata (URL, auth method, last successful probe, last failure) lives in `profiles.json` in the CLI's config directory, at mode `0600`. The directory is `$XDG_CONFIG_HOME/metabase-cli` (by default `~/.config/metabase-cli`), or `%APPDATA%\metabase-cli` on Windows. The secrets (an API key, or OAuth access and refresh tokens) sit in the OS keychain when one is available, or inline in the same file when it is not.

## The server probe

A probe reads the current user and the server's properties with the profile's credential. [`mb auth login`](#mb-auth-login) probes before it saves a credential, and [`mb auth list`](#mb-auth-list) probes every profile again. [`mb auth status`](#mb-auth-status) only reads what the last probe cached. Other commands read the server's version and features from the cached probe instead of probing again.

A successful probe replaces the cached one and clears `lastFailure`. A failed probe records `lastFailure` and leaves the cached probe, the URL and the credential as they were.

In the table output, `login` and `status` show the probed user, and all three commands show the role (`Admin` or `User`), the Metabase version and the skew. `--json` adds `edition`, `tokenFeatures`, `knownRange` (the Metabase majors this CLI knows) and the `features` map that an explained refusal names. The skew is one of:

| `skew`             | Shown as                                     |
| ------------------ | -------------------------------------------- |
| `supported`        | supported                                    |
| `older-than-known` | older than this CLI supports (vN min)        |
| `newer-than-known` | newer than this CLI knows (vN max)           |
| `development`      | development build (newer than every release) |

## mb auth login

Log in to a Metabase instance for a profile.

Interactive login offers browser OAuth (recommended; Metabase v62.3.3+) or an API key — older servers fall back to the API key prompt automatically. Browser login opens Metabase, you sign in (password or SSO) and approve, and the CLI stores a short-lived access token and a rotating refresh token, which it refreshes on its own; the API key choice prompts for a key from Admin settings → Authentication → API keys. For CI/non-interactive use, supply an API key via --api-key (`--api-key -` reads it from stdin), piped stdin, or $MB_API_KEY (first non-empty wins); any of these skips the browser flow, even on a TTY, and without one a non-TTY login fails rather than prompting. A key given as the --api-key value shows in shell history, so login warns about it. The URL comes from --url or $MB_URL, prompted when stdin is a TTY. Unless --skip-verify is given, login then probes the server and caches the result in the profile. If the probe fails, nothing is saved: an existing profile keeps its last good credential and records a `lastFailure`, and new browser tokens are revoked.

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
mb auth login
mb auth login --url https://metabase.example.com
echo $MB_API_KEY | mb auth login --url https://metabase.example.com
pass show metabase | mb auth login --url https://metabase.example.com --api-key -
mb auth login --profile staging --url https://staging.example.com
```

## mb auth status

Show authentication status for a profile.

Reads what the last probe cached in the profile and never contacts the server. Shows the auth method (`OAuth` or `API key`) with the cached user, role, server version and skew.

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

Probes every listed profile again, one at a time: a probe can refresh and rewrite an expired OAuth token in the shared `profiles.json`. --limit and --offset choose the profiles before any probe. The table shows profile, URL, auth method, status, role, version, skew and last probe time; `status` is `ok`, `auth-failed`, `network-error`, `server-error` or `not-probed` (no stored credential). For an `auth-failed` row a warning names the `mb auth login --profile <name>` that updates its token.

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

Clears the local credentials first. For an OAuth profile it then revokes the tokens on the server, best-effort: a revocation failure only warns, so a slow or offline server never blocks the logout.

```sh
mb auth logout [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation; without a TTY there is no prompt. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags).

Output schema: `mb schema auth logout --output`.

Examples:

```sh
mb auth logout --yes
mb auth logout --profile staging --yes
```
