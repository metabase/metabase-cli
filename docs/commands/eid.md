---
title: "mb eid"
summary: "Translate Metabase entity ids (string EIDs) to numeric ids."
---

# mb eid

Translate Metabase entity ids (string EIDs) to numeric ids.

Entity IDs are NanoIDs that can start with `-`, which the positional form reads as a flag; shell quoting doesn't help, because the leading `-` survives into argv. Pass such an ID via `--body`, as a JSON string: `mb eid --body '{"entity_ids":{"card":["-s3mHTaWs8T-VLPYEeraG"]}}'`.

```sh
mb eid [eids] [flags]
```

| Argument | Description |
| --- | --- |
| `[eids]` | Comma-separated EIDs to translate (used with --model). |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |
| `--model <value>` |  | Entity model for the positional EIDs: action \| card \| collection \| dashboard \| dashboard-card \| dashboard-tab \| dataset \| dimension \| document \| exploration \| measure \| metric \| permissions-group \| pulse \| pulse-card \| pulse-channel \| segment \| snippet \| timeline \| transform \| user. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema eid`. Output schema: `mb schema eid --output`.

Agent skills:

- `mb skills get core`: entity-id translation and body input

Examples:

```sh
mb eid --model card Ss3mHTaWs8T-VLPYEeraG,5oQpn8LO4qXBRZ1Wq3jIp
mb eid --file translate.json
mb eid --body '{"entity_ids":{"card":["Ss3mHTaWs8T-VLPYEeraG"]}}'
```
