---
name: ci-setup
description: Install `mb ci run` as a GitHub Actions check on a Metabase content repo (one that remote sync or serialization writes). Covers the dry run, `.metabase-lint.json` (default schemas and engines), the workflow and `ci/prepare.sh` templates, the empty stand-in databases, the opt-in `run-ci` label, and what a first red run usually means. Load when the user says "set up CI for this repo", "add Metabase CI", "install mb ci", "run transform tests on PRs", or asks why a fresh Metabase CI workflow is red. Running and fixing a check once it exists is the `ci` skill.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Installing Metabase CI on a content repo

The check runs `mb ci run` on each pull request. It needs no long-lived Metabase and no warehouse: the job starts a throwaway Metabase, connects empty containers of the content's database engines, imports the PR's commit, and runs the checks against it. Transform tests are synthetic: each declares its input rows, Metabase loads them into temp tables, and it refuses to run a test that would read a real table. So the tests need the right SQL engine, not the data.

| Stage  | Needs                                             | Catches                                                                                                         |
| ------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lint` | only the repo                                     | a new or edited transform with no test; reference lint over the whole repo; a file that fails its entity schema |
| `unit` | the throwaway Metabase and the stand-in databases | a transform whose test fails on the PR's version of it                                                          |

Reading and fixing a run once the check exists is the `ci` skill (`mb skills get ci`). Don't restate it here.

## What you need from the user

Ask for these before writing anything. Don't guess a name.

1. **The databases the transforms use:** each one's name exactly as the content's YAML spells it (`database:` in a transform), and its engine. Read engines from the user's Metabase (`mb db list --json`).
2. **A Metabase license** that includes transforms. Internal dev tokens need the two `dev` lines in the workflow; a production license doesn't.

PR CI needs no warehouse login and no network path. Check for the two cases that would, and tell the user:

- an engine with no container image (Snowflake, BigQuery, Redshift and other hosted warehouses): its transforms' tests can't run in CI;
- a test input with `format: sql`: it runs verbatim against the source database, so it would read real tables.

## Steps

1. **Dry-run on the default branch** from the repo root, with no Metabase:

   ```bash
   mb ci run --repo . --base origin/main --format text
   ```

   Expect the `unit` stage to stop for lack of a Metabase. Read the `lint` stage: it tells you what the next step must fix.

2. **Write `.metabase-lint.json`** at the repo root from `templates/metabase-lint.json`:
   - `defaultSchemas`: the schema an unqualified table name resolves to, per database. The linter refuses to run without it when a table name exists in two schemas, and its error names the databases. Postgres and Redshift: usually `public`. ClickHouse: `default`. Ask the user if unsure.
   - `engines`: each database's engine (`postgres`, `clickhouse`, `snowflake`, …), so the linter parses the SQL in the right dialect. Without it, SQL that uses dialect features fails to parse and shows as `reads-not-checked` warnings.
   - Read engines from the user's Metabase when you can (`mb db list --json` shows each database's `engine`), not from the SQL.

   Rerun the dry run until lint has no setup error and no `reads-not-checked` warnings caused by parsing.

3. **Clear the default branch's lint errors.** Lint reads the whole repo, so an error already on the default branch fails every PR. Fix each one or, with the user's agreement, delete abandoned content. Don't weaken the check to get past them.

4. **Add the workflow and the setup script:**
   - `templates/metabase-ci.yml` -> `.github/workflows/metabase-ci.yml`. Fill in the database names and the `mb` version. Pin the version you are running (`mb --version`) exactly, since dist-tags move.
   - `templates/prepare.sh` -> `ci/prepare.sh`, and `chmod +x` it. It sets up an admin and an API key, connects each database in `CI_DATABASES`, and imports the commit.
   - Keep one service container per engine the content uses (the template has Postgres and ClickHouse), and list each database in `CI_DATABASES` under its exact name, pointing at its engine's service. Databases on the same engine can share one container.

5. **Secret and label.** The user adds the secret; never print or commit its value.
   - `MB_PREMIUM_EMBEDDING_TOKEN`: the license.
   - Create the label: `gh label create run-ci --description "Run Metabase CI on this pull request"`.

6. **Prove it:** open the PR with the `run-ci` label. Read the job summary, which holds `mb ci run`'s text report. The run must import the commit, and must show `PASSED`, or `FAILED` only for real findings. A PR that touches no transform runs no tests, so its green proves only the setup. Then push a change to one test file, and check that the `unit` stage runs that test.

## What a red first run usually means

| Shows                                                                               | Cause                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `! Representation lint error`, "default schema … is unknown"                        | Step 2 not done                                                                                                                      |
| `✗ <transform>: <rule>` on content the PR didn't touch                              | An error already on the default branch (step 3)                                                                                      |
| `unit stopped: no Metabase credential`                                              | The workflow has no Metabase, or `prepare.sh` failed before printing the key                                                         |
| a transform test `error`: "Cannot connect to a private or internal network address" | The test's database isn't in `CI_DATABASES`, or its name differs from the YAML (see the `prepare.sh` warning)                        |
| a test fails in CI but passes in the user's Metabase                                | The stand-in's engine version or settings differ from production. Match the image version to production before blaming the transform |
| `Load this commit into Metabase` red, `mb ci run` green                             | The import failed; its log says why, and lint usually explains it                                                                    |

## Don't

- Point `MB_URL` at the user's real Metabase. It holds the default branch's content, so `unit` would test the wrong version of every transform.
- Connect the real warehouse for PR tests. They don't need its data, and any PR's code could reach its credentials.
- Add `continue-on-error` to the `mb ci run` step. GitHub shows a green tick, and nobody sees the findings. To keep a red run from blocking merges, leave the check out of the required checks.
- Make the check required before the default branch passes it.
