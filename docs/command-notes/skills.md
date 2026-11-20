The CLI ships agent skills that document `mb` itself, in the layout Claude Code and `npx skills add` read. They are served from the installed CLI, so the instructions an agent reads always match the binary it runs. `mb skills list` names them.

## Skills and the server

A skill describes the newest Metabase and declares what it relies on: its frontmatter carries `requires: [<feature>, …]` (names from the client's feature table, such as `transforms` or `remoteSync`), and a passage inside a skill or one of its references sits between `<!-- requires: <feature>, … -->` and `<!-- /requires -->` markers, each on its own line.

`skills list` and `skills get` read the profile's cached server probe, with no request, and resolve both against it. A skill whose features the server lacks is left out and reported in the JSON envelope's `unavailable` array as `{ name, failure }`, where `failure` is the same `{ reason, detail, feature, since, tokenFeature, serverVersion }` a refused command carries; text mode reports each one on stderr. A section the server can use keeps its text and loses its markers; one it cannot use is removed. A marker inside a fenced code block is text.

Without a cached probe nothing is filtered, `unavailable` is `null`, the markers print as written, and text mode says why on stderr: no such profile, a profile never probed, or no probe for the URL `MB_URL` points at. `--unfiltered` skips the filter and prints the selected skills as written.

An unknown feature name, an unbalanced marker pair, or a marker between table rows is an error on every read, so a typo fails the gate rather than hiding a skill.

## Exit codes

`0` on success; a skill the server cannot use is reported, not refused. `2` for a missing or unknown skill name, an `MB_SKILLS_DIR` that is not a directory, an unknown feature in `requires`, or an unbalanced section marker. `1` for an unexpected I/O failure.
