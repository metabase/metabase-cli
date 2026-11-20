---
title: "mb auth"
summary: "Authenticate against a Metabase instance."
---

# mb auth

Authenticate against a Metabase instance.

Without a command, `mb auth` runs `mb auth login`.

Every command on this page takes the [output](README.md#output-flags) flags.

Agent skills:

- `mb skills get core`: authentication and named profiles

## Each profile has its own credential

The CLI stores credentials per profile. The default profile is `default`; pass `--profile <name>` (`-p`) to log in to, inspect or clear another one, or to point any other command at it.

Each profile's URL, auth method and last probe go in `profiles.json` (mode `0600`) in `$XDG_CONFIG_HOME/metabase-cli` (`~/.config/metabase-cli` by default), or `%APPDATA%\metabase-cli` on Windows. Secrets (an API key, or OAuth tokens) go in the OS keychain when there is one, and in the same file when there isn't.

## A probe checks the credential and caches the server

A probe reads the current user and the server's properties with the profile's credential. [`mb auth login`](#mb-auth-login) probes before it saves a credential, and [`mb auth list`](#mb-auth-list) probes every profile again. [`mb auth status`](#mb-auth-status) reads only what the last probe cached, as every other command does for the server's version and features.

A successful probe replaces the cached one and clears `lastFailure`. A failed probe records `lastFailure` and leaves the cached probe, the URL and the credential as they were.

The text output of `login` and `status` shows the probed user, and all three commands show the role (`Admin` or `User`), the Metabase version and the skew. `--json` adds `edition`, `tokenFeatures`, `knownRange` (the Metabase majors this CLI knows) and the `features` map that an explained refusal names. The skew is one of:

| `skew`             | Shown as                                     |
| ------------------ | -------------------------------------------- |
| `supported`        | supported                                    |
| `older-than-known` | older than this CLI supports (vN min)        |
| `newer-than-known` | newer than this CLI knows (vN max)           |
| `development`      | development build (newer than every release) |

## mb auth login

Log in to a Metabase instance for a profile.

Interactive login offers browser login (recommended; Metabase v62.3.3+) or an API key from **Admin** > **Settings** > **Authentication** > **API keys**; older servers go straight to the API key prompt. Browser login opens Metabase for you to sign in and approve, then stores tokens that the CLI refreshes on its own. For CI and other non-interactive runs, pass an API key with `--api-key`, piped stdin, or `$MB_API_KEY` (the first one given wins; `--api-key -` reads stdin and keeps the key out of shell history); any of these skips the browser, and a non-TTY login without one fails. The URL comes from `--url`, `$MB_URL`, or a prompt on a TTY. Unless `--skip-verify` is given, login probes the server, and saves nothing if the probe fails.

```sh
mb auth login [flags]
```

| Flag | Description |
| --- | --- |
| `--client-id <value>` | Pre-registered OAuth client id (when dynamic registration is disabled). |
| `--skip-verify` | Save without contacting the server. |

Also takes the [profile](README.md#profile-flags) and [connection](README.md#connection-flags) flags.

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

Also takes the [profile](README.md#profile-flags) flags.

Examples:

```sh
mb auth status --json
mb auth status --profile staging
```

## mb auth list

List configured authentication profiles.

Probes every listed profile again, one at a time, which can refresh and save an expired OAuth token. `--limit` and `--offset` pick the profiles before any probe. `status` is `ok`, `auth-failed`, `network-error`, `server-error` or `not-probed` (no stored credential); for each `auth-failed` row, a warning gives the `mb auth login --profile <name>` command that renews it.

```sh
mb auth list [flags]
```

Also takes the [list](README.md#list-flags) flags.

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

| Flag | Description |
| --- | --- |
| `--yes` | Skip confirmation; without a TTY there's no prompt. |

Also takes the [profile](README.md#profile-flags) flags.

Examples:

```sh
mb auth logout --yes
mb auth logout --profile staging --yes
```
