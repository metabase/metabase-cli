---
name: ci
description: Run `mb ci run` on a branch of Metabase content, read its JSON events, and fix what failed. Covers exit codes, `job.end.state` (`failed` vs `errored`), `job.start.checked`, the `uncommitted-content` and `no-content-changes` warnings, coverage failures, a failing transform test's row diff, and the judgment call between a wrong transform and a wrong expectation. Load after editing transforms or their tests and before marking a PR ready, or when the user says "run CI", "check my branch", "why did CI fail", "fix the failing transform test", "is my PR green", or anything `mb ci …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [transformTests]
---

# CI for transforms

`mb ci run` compares a branch with its merge base, finds the transforms whose files or tests changed, and checks them in two stages: `lint` (coverage, needs no Metabase), then `unit` (runs those transforms' tests on a Metabase instance). It writes one JSON event per line. `mb ci run --help` is the authority on behavior.

Test mechanics (the body shape and every `mb transform-test` verb) live in the `transform` skill (`mb skills get transform`). Deciding what to test and deriving expected rows live in `transform-test-plan`. Load both before you write or edit a test, and don't restate them here.

## When to run it

Run it after you edit transforms or their tests, and before you mark a PR ready. It sees two things, and both must hold your change:

- **The commit.** CI checks committed content only. An uncommitted edit is invisible, and CI checks the file's committed version instead.
- **The instance.** The `unit` stage runs the tests stored on the Metabase that `--url`, `MB_URL` or `--profile` names, in that order. That instance must already hold the branch's content. If you edited in the instance, export to the branch; if you edited YAML in the repo, commit it and import the branch. Both directions are in the `git-sync` skill. A test you edited in the repo but did not import runs in its old form.

```bash
mb ci run --base origin/main --profile <n>
mb ci run --base origin/main --profile <n> --results ./.scratch/ci.json   # also every event as one JSON array
mb ci run --base origin/main --profile <n> | jq -c 'select(.type == "check.result" and .verdict != "passed")'
```

## The loop

1. Edit transforms and tests.
2. Commit, and get the branch's content onto the instance.
3. Run `mb ci run`.
4. Compare `job.start.checked` with what you changed, and act on every warning. **A green job says nothing about a transform it did not check.**
5. Fix what failed, then go back to step 2.

## Reading the result

| Exit | Meaning                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The job passed.                                                                                                                                                         |
| 1    | After `job.end`: the job did not pass, so read `job.end.state`. With no `job.end`: a crash, such as a changed content file that does not parse; the error is on stderr. |
| 2    | Usage or config error: a bad flag, a ref git cannot resolve, or no Metabase credential when a transform needs testing.                                                  |
| 130  | Interrupted. No `job.end`, and no `--results` file.                                                                                                                     |

`job.end.state`:

- **`failed`**: a check found the change wrong. Fix the transform, after the judgment rule below.
- **`errored`**: no check failed, but one could not judge the change (verdict `error` or `refused`, or a stage that stopped early with a reason in `stage.end.stopped`). Fix the test or the setup.

A failure outranks errors. The stages gate each other: when `lint` does not pass, `unit` is reported `skipped`, so no test ran, and fixing `lint` can surface new test failures. When `checked` is empty, the job has no `unit` stage at all.

`job.start`:

- **`checked`** lists the transforms the job covered, as `{entity_id, name}`. If a transform you changed is missing, you did not commit it, or its file is not a content file (a `.yaml` under a serialization folder such as `transforms/`). Commit it and run again.
- **`uncommitted-content`** lists content files with uncommitted changes. CI checked their committed versions. Commit them and run again. It fires only when `--head` is the checked-out commit.
- **`no-content-changes`** means the change touches no content file, so CI checked nothing. Exit 0 here proves nothing.
- **`missing-transform`** means a changed test covers a transform that is not in the repo at `--head`. Commit the transform, or fix the test's `transform_id`.

Each `check.result` carries `check.kind`, `check.label`, a `verdict` (`passed`, `failed`, `error`, `refused`) and a `detail`.

### Coverage failures

A `coverage` check fails for each transform the branch adds (`detail.change: "new"`) or whose logic (`source` or `target`) it edits (`"edited"`) and that has no transform test. Write one by following `transform-test-plan`, then commit it and load it onto the instance. An edit to only the name, description or tags does not count as a logic edit. The `no-tests-untouched` warning, on the passing coverage check with id `untouched` (so a `verdict != "passed"` filter hides it), lists untested transforms the branch did not touch: that is information, not a task.

### A failed transform test

The check's label is `<transform>: <test>`. When the test ran, its `detail` is the run result; when it did not, `detail` is `{error_code, message, …}`. Each entry of `detail.expectations` has a `name`, a `type` and a `status`. A failed `equals` carries:

- `row-counts`: `{actual, expected}`.
- `missing-rows`: expected rows the output lacks.
- `extra-rows`: output rows the test did not expect.
- `cell-mismatches`: `{column, expected, actual}`, filled only when exactly one row is missing and exactly one is extra.
- `truncated`: how many rows a cap dropped from the two row lists.

To read a row diff, pair each missing row with the extra row that has the same key. The columns that differ show where the logic went wrong. A missing row with no partner means the transform dropped rows (an inner join where a left join belongs, an over-tight filter). An extra row with no partner means a fan-out or a filter that lets too much through. Equal counts with different values point to a computation. A failed `empty` carries `sample`: output rows that break the invariant its name states.

A `failed` check whose `detail.error_code` is `transform-test.transform-failed` or `transform-test.unparseable-source` means the transform's own query does not run. Fix the transform.

## The fix: transform or expectation?

A failure means the transform is wrong **or** the expected rows are wrong. CI cannot tell which; you decide.

1. Read the test's inputs and expectations: `mb transform-test get <id> --full --json`.
2. Derive the expected rows for the failing cells by hand, from the fixture story and what the transform is meant to compute. Never run the transform and copy its output into the test: that asserts only that the transform equals itself.
3. Compare:
   - Your rows match the test: the transform is wrong. Fix the transform.
   - Your rows match the actual output: the expectation is wrong. Fix the test, and record the arithmetic in the plan.
   - Neither, or the intended meaning is unclear: ask the user.
4. Commit, load the branch onto the instance, and run again.

## `errored`: fix the test or the setup

| Result                                                                                                              | Cause                                                                                                                                              | Do                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `refused`, `transform-test.*` code (`missing-inputs`, `unused-inputs`, `unknown-column`, `unremapped-reference`, …) | Metabase will not run the test as written. `unknown-column` means an expectation names a column the transform no longer outputs.                   | Fix the test's inputs or expectations. `message` and `tables` name the problem. If the column was dropped on purpose, update the test. |
| `error`, an expectation with `status: "error"`                                                                      | The expectation's own SQL broke.                                                                                                                   | Fix the expectation SQL.                                                                                                               |
| `refused`, `ci.transform-not-on-instance`                                                                           | The branch has the transform; the instance does not.                                                                                               | Load the branch into Metabase, then run again.                                                                                         |
| `refused`, `ci.invalid-entity-id`                                                                                   | The transform's `entity_id` in the branch is malformed.                                                                                            | Fix the YAML.                                                                                                                          |
| `refused`, `ci.transform-unreadable` or `ci.test-run-forbidden`                                                     | The credential lacks query permission on the transform's tables, or write access to the test. A read-only remote-synced instance refuses everyone. | Fix the credential or the instance, not the test.                                                                                      |
| `error`, `ci.http-error`, `ci.timeout`, `ci.network-error` or `ci.unreadable-answer`                                | One request failed, and the next test still ran. A `ci.network-error` before a test runs stops the stage instead.                                  | Run again. If it repeats, check the instance.                                                                                          |
| `stage.end.stopped`: `ci.unauthorized`, `ci.unsupported-server`, or a request code                                  | Every later request would fail, so the stage stopped.                                                                                              | Fix the credential, use a server with transform testing, or start Metabase.                                                            |

## Don't

- Don't weaken or delete a test, or drop a column from an expectation, to get green. Change an expectation only when your hand-derived rows show it was wrong.
- Don't copy the transform's actual output into the expected rows.
- Don't treat a green job as covering transforms missing from `job.start.checked`, or a run with `uncommitted-content` or `no-content-changes` as proof.
- Don't rerun a `failed` job hoping it passes. Rerun only for `ci.*` request errors.
