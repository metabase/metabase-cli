# Reading the diagnostics feed

`npm run dev` serves everything the toolbar shows as JSON — the only way _you_
see runtime failures, since sandbox blocks, CSP refusals, failed queries and
uncaught errors reach neither the terminal nor `npm run typecheck`. Check it
after any change you can't verify by reading the code.

**Loop:** note `nextEventId` before editing → make the change (rebuilds
automatically) → re-read. `startEventId` is inclusive and survives page reloads.

```bash
curl -s "http://localhost:5174/__data-app/diagnostics?startEventId=0"
```

```jsonc
{
  "entries": [
    {
      "eventId": 31,
      "kind": "blocked-network",
      "alert": true,
      "summary": "Blocked fetch to api.example.com (not in allowed_hosts)",
      "detail": null, // stack frames, when any
      "hint": "Add https://api.example.com to allowed_hosts in data_app.yaml …",
      "buildId": 7, // the bundle generation that reported it
    },
  ],
  "clients": 1, // connected preview tabs — 0 means nothing ran
  "buildId": 7, // the generation running now
  "staleEntries": 164, // held back, reported by an older build — see below
  "nextEventId": 32, // pass back as ?startEventId=
}
```

**`clients: 0` does not mean healthy** — it means no preview tab is open, so an
empty `entries` proves nothing. Open `http://localhost:5174` first.

**The feed answers for the bundle that is running, not for everything that ever
happened.** Every save rebuilds and remounts the app, so a multi-step edit runs
through builds that don't compile or don't render — errors from those describe
code the preview has already replaced. They're withheld and counted in
`staleEntries`; read mid-edit and you see the current build's failures, not a
pile of them. Nothing is lost: the rebuild re-runs the app from scratch, so
anything still broken reports itself again under the new `buildId`, and
`?includeStale=true` hands back the withheld entries when comparing builds is
the point. A _failed_ build doesn't advance `buildId` — the preview keeps
running the last good bundle, so its entries stay current.

Triage by `kind` (always read `hint` — it names the exact fix; never soften a
`summary` when reporting it):

| `kind`                              | Fix                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `blocked-network` / `csp-violation` | add the origin to `allowed_hosts` in `data_app.yaml`, then **restart** `npm run dev` (allowlist + CSP are read at boot) |
| `blocked-api`                       | blocked in production too — use an SDK API or drop the call, don't work around it                                       |
| `sdk-call` + `alert: true`          | a Metabase request failed; fix the query — `summary` has the endpoint and status                                        |
| `error`                             | a real bug; `detail` has the stack                                                                                      |

Text is truncated and the buffer holds the last 200 events. `curl -X DELETE
.../__data-app/diagnostics` clears it for every reader.
