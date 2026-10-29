---
name: ci-setup
description: Install `mb ci run` as a GitHub Actions check on a Metabase content repo (one that remote sync or serialization writes). Covers the dry run, `.metabase-lint.json` (default schemas and engines), the workflow and `ci/prepare.sh` templates, the secrets and network path, the opt-in `run-ci` label, and what a first red run usually means. Load when the user says "set up CI for this repo", "add Metabase CI", "install mb ci", "run transform tests on PRs", or asks why a fresh Metabase CI workflow is red. Running and fixing a check once it exists is the `ci` skill.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Installing Metabase CI on a content repo

The check runs `mb ci run` on each pull request. It needs no long-lived Metabase: the job starts a throwaway one, connects the warehouse through a read-only login, imports the PR's commit, and runs the checks against it. Transform tests write only temporary tables, so a read-only login is enough.

| Stage  | Needs                                    | Catches                                                                                                         |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lint` | only the repo                            | a new or edited transform with no test; reference lint over the whole repo; a file that fails its entity schema |
| `unit` | the throwaway Metabase and the warehouse | a transform whose test fails on the PR's version of it                                                          |

Reading and fixing a run once the check exists is the `ci` skill (`mb skills get ci`). Don't restate it here.

## What you need from the user

Ask for these before writing anything. Don't guess a name or a login.

1. **The warehouse:** its name exactly as the content's YAML spells it (`database:` in a transform), and its folder under `databases/`.
2. **A read-only login** as `postgresql://user:password@host:port/dbname[?sslmode=require]`: `SELECT` on the schemas the transforms read, and `TEMP`, nothing else. `prepare.sh` connects Postgres only.
3. **How GitHub's runners reach the warehouse:** directly, or through a VPN or tailnet that needs its own step and secrets.
4. **A Metabase license** that includes transforms. Internal dev tokens need the two `dev` lines in the workflow; a production license doesn't.

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
   - `templates/metabase-ci.yml` -> `.github/workflows/metabase-ci.yml`. Fill in `WH_NAME`, `WH_DIR` and the `mb` version. Pin the version you are running (`mb --version`) exactly, since dist-tags move.
   - `templates/prepare.sh` -> `ci/prepare.sh`, and `chmod +x` it. It sets up an admin and an API key, connects the warehouse (syncing only the schemas under `databases/<WH_DIR>/schemas`), and imports the commit.
   - If a VPN or tailnet is needed, add its step where the template's comment says, gated on the warehouse secret existing.

5. **Secrets and label.** The user adds the secrets; never print or commit their values.
   - `MB_PREMIUM_EMBEDDING_TOKEN`: the license.
   - `WAREHOUSE_URL`: the read-only login.
   - Create the label: `gh label create run-ci --description "Run Metabase CI on this pull request"`.

6. **Prove it:** open the PR with the `run-ci` label. Read the job summary, which holds `mb ci run`'s text report. The run must import the commit, and must show `PASSED`, or `FAILED` only for real findings. Then push a change to one transform with its test, and check that the `unit` stage runs that test.

## What a red first run usually means

| Shows                                                                               | Cause                                                                                                                               |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `! Representation lint error`, "default schema … is unknown"                        | Step 2 not done                                                                                                                     |
| `✗ <transform>: <rule>` on content the PR didn't touch                              | An error already on the default branch (step 3)                                                                                     |
| `unit stopped: no Metabase credential`                                              | The workflow has no Metabase, or `prepare.sh` failed before printing the key                                                        |
| a transform test `error`: "Cannot connect to a private or internal network address" | No warehouse connected: `WAREHOUSE_URL` is unset, or the content names a database CI doesn't connect (see the `prepare.sh` warning) |
| `Load this commit into Metabase` red, `mb ci run` green                             | The import failed; its log says why, and lint usually explains it                                                                   |

## Don't

- Point `MB_URL` at the user's real Metabase. It holds the default branch's content, so `unit` would test the wrong version of every transform.
- Give CI a login that can write outside temporary tables.
- Add `continue-on-error` to the `mb ci run` step. GitHub shows a green tick, and nobody sees the findings. To keep a red run from blocking merges, leave the check out of the required checks.
- Make the check required before the default branch passes it.
