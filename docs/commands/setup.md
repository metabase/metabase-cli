---
title: "mb setup"
summary: "Complete the initial Metabase setup wizard with a default user."
---

# mb setup

Complete the initial Metabase setup wizard with a default user.

Bootstraps a fresh Metabase instance that isn't set up yet. The body carries the setup token, the default user, and a `prefs` block with `site_name`.

```sh
mb setup [flags]
```

Takes the [output](README.md#output-flags), [body](README.md#body-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Examples:

```sh
cat setup.json | mb setup
mb setup --file setup.json
mb setup --body '{"token":"<setup-token>","user":{"email":"a@b.c","password":"..."},"prefs":{"site_name":"Acme"}}'
```
