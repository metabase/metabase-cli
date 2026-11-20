---
title: "mb ci"
summary: "Check a branch's transforms the way CI does."
---

# mb ci

Check a branch's transforms the way CI does.

## mb ci run

Check the transforms a branch changed, reporting each check as it finishes.

Finds the transforms whose files or tests changed between `--head` and its merge base with `--base`, and checks them in two stages. `lint` fails a transform the branch adds or edits (its source or target) without a transform test, and one the branch strips of its last test; it warns about untested transforms the branch didn't change. A test counts only when it's a TransformTest file at `--head` whose `transform_id` names the transform and whose `expectations` aren't empty.

An edit is a change to the query text, whitespace included, not to the YAML layout alone. A transform whose source type isn't `query`, such as a Python transform, can't have tests, so `lint` lists it in an `untestable-transform` warning instead of failing it.

`unit` runs the instance's tests of the transforms in `job.start.checked` on the Metabase that `--url`, `MB_URL` or `--profile` names, in that order, and that instance must already hold the branch's content. It runs even when `lint` fails, and it's skipped when `checked` is empty, so a job with nothing to test never connects. A checked transform with no test on the instance is `refused` with `ci.no-tests-on-instance`.

Only committed content files are checked: the `.yaml` files Metabase's import reads, under a top-level serialization folder such as `transforms/` or `collections/`, dotfiles excluded. When `--head` is the checked-out commit, an `uncommitted-content` warning lists the content files with uncommitted changes.

With `--format json`, the default off a terminal, each event is one JSON line: `job.start`, each stage and check, then `job.end`. A check's `detail` is the transform test's result, with every row the server sent. A `no-content-changes` warning says the change touched no content file; an `unread-content` warning lists the untouched content files at `--head` that the check can't read and coverage skips.

With `--format text`, the default on a terminal, the same events print as lines, with up to `--max-rows` missing and extra rows for each failed expectation. The `--results` file is always JSON, with every row.

Unless `--no-run-log` is given, each run also writes its events as JSON lines to `.scratch/ci-runs/<started-at>-<job>.jsonl` under the repository root, which git ignores, so a UI can show every run. A run that crashes or is interrupted keeps its log, which stops before `job.end`; an error before `job.start`, such as a `--base` git can't resolve, leaves none.

Exits 0 when the job passes, and 1 after `job.end` when it doesn't: `state` is `failed` when a check failed (fix the transform), or `errored` when none failed but one couldn't judge the change (fix the test or the setup). Exits 2 on a usage or config error: a bad flag, a `--repo`, `--base` or `--head` git can't resolve or relate, or a configuration the unit stage can't use, such as a browser-login profile bound to another URL. A missing credential isn't one: it ends the unit stage.

A test run that times out, loses its connection or gets an HTTP error is an `error` check with a `ci.`-prefixed `detail.error_code`, and the next test runs. A failure every later request would repeat ends the unit stage early (`errored` unless a check failed), with the reason in `stage.end.stopped`: no credential (`ci.no-credential`), a rejected credential, no transform testing on the server, a failed entity-id lookup, or a Metabase it can't reach before the first test.

A crash, such as a touched content file that doesn't parse at `--head`, exits 1, and an interrupt exits 130. Either way the stream stops before `job.end`, the error goes to stderr, and no `--results` file is left, not even an earlier run's. If the reader closes stdout early, the job still runs to the end, writes `--results`, and exits by its state.

```sh
mb ci run [flags]
```

| Flag | Description |
| --- | --- |
| `--base <value>` | Required. Ref the branch is compared against. |
| `--head <value>` | Ref to check. Default: `HEAD`. |
| `--repo <value>` | Path inside the git work tree to check. Default: `.`. |
| `--results <value>` | Also write every event to this file, as one JSON array, with every row the server sent. |
| `--run-log, --no-run-log` | Append every event to a log under `.scratch/ci-runs`, so a UI can show the run. Default: `true`. |
| `--max-rows <value>` | Row lines each failed expectation shows under `--format text`; 0 shows only counts. JSON output and the `--results` file keep every row. Default: `5`. |

Takes the [format](README.md#format-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Needs `transformTests` (v65+, token transforms-testing).

Examples:

```sh
mb ci run --base origin/main
mb ci run --base origin/main --format text --results results.json
```
