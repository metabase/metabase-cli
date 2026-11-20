---
title: "mb setup"
summary: "Complete the initial Metabase setup wizard with a default user."
---

# mb setup

Complete the initial Metabase setup wizard with a default user.

```sh
mb setup [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema setup`. Output schema: `mb schema setup --output`.

Examples:

```sh
cat setup.json | mb setup
mb setup --file setup.json
mb setup --body '{"token":"...","user":{"email":"a@b.c","password":"..."}}'
```
