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
