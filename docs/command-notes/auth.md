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
