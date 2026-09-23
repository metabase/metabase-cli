---
name: rde
description: Data engineering with Metabase at the center, where the work is files on the session's branch. Explore and profile raw tables, build clean tables as transforms pinned by transform tests, build the semantic layer (measures, segments, metrics, metadata), design dashboards, answer questions with checked numbers, reconcile against a reference, and change delivered definitions safely. Use when the user wants data work done rather than one command, as in "make sense of my data", "model this raw schema", "define MRR officially", "go from raw tables to a dashboard", "does this number match finance", "test this transform", "be my data engineer".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
requires: [remoteSync, transforms]
---

# rde

You are the data engineer. Load one playbook, read what its `Read first` line names, follow it. Read nothing else. The playbooks and references sit beside this file: `mb skills path rde`, then Read `playbooks/<name>.md` or `references/<name>.md`.

## Before any work

1. `cat ./.scratch/STATE.md`. If it exists, resume per `references/state.md` and never re-ask what it holds. If not, create it from that schema once the database is known, and write every id, decision and question into it the moment it is known.
2. `mb db list --json` names the databases. The CLI's credential comes from the environment the app sets; never ask the user to log in or for a key.
3. Read `references/collaboration-contract.md` once per job; its outputs, the owner and the autonomy mode, live in STATE.md.

## mb conventions

`--json` on every command; parse, never scrape. `--fields a,b` narrows a list. A list envelope is `{returned, offset, total, has_more, next_offset, data}`; continue with `--offset <next_offset>` while `has_more`. Bodies come from a file in `./.scratch` (`--file`) written with a quoted heredoc. `mb query` that cannot run fails on stderr with empty stdout; a query that runs and fails prints `{status:"failed"}` on stdout with exit 0; test `.status == "completed"`. Row ceilings and the extract path: `references/profiling-catalog.md`. Probe with `q()` from `references/state.md`. Schema comes from `.metadata/databases/` (`mb skills get metabase-database-metadata`), never from `table_metadata.json`. Every Metabase mechanic lives in the bundled skills: run `mb <cmd> --help` before a verb you have not run, `mb skills path <name>` then Read the one section a step names, and `mb skills get core` for the loop and the footguns.

## Where the work lands

On the session's branch, always. Every transform, card, metric, measure, segment, dashboard and document is a YAML file in this checkout (`mb skills get metabase-representation-format`); no command creates or changes one. Each step that builds something runs the loop from `core`:

1. Write or edit the file; ids from `mb entity-id` and `mb uuid`; tables and fields by natural key, other entities by `entity_id`.
2. `mb validate` the changed files; fix every error.
3. Commit with a message saying what and why, and push the branch.
4. `mb git-sync import --branch <branch>`; read a failure's message from the JSON, fix the file, go again.
5. Prove it on the instance: the numeric id from `mb eid --model <model> <entity_id>`, then `mb transform run <id> --sync`, `mb transform-test run <id>`, `mb card query <id>`, `mb dashboard get <id>`.

Iterate by editing the same file: its `entity_id` keeps the row, the table and every reference to it. Never delete and recreate. Transform tests are the exception to "everything is a file": they are written with `mb transform-test create|update` against the transform's numeric id, after the import (`references/transform-tests.md`). Transforms file only in `transforms`-namespace collections; cards and dashboards in ordinary ones.

Read the `git-sync` skill's branch guard before the first import: import the session branch, never the tracked branch (`main`, `master`) without the user's confirmation. The connected instance holds whatever was imported last, so unfinished dashboards live in a `Drafts` collection until they pass their gate. The branch is the review: when the job is done the user opens the pull request, and merging it and importing the tracked branch is the reviewer's step. Record the branch in STATE.md.

## Route, first match wins

1. STATE.md exists: continue at its `stage`.
2. The ask names a reference, a mismatch, or two numbers that disagree: `playbooks/validate-and-reconcile.md`.
3. It names code, documents, a spreadsheet, or another tool's project as the source of rules: `playbooks/extract-business-logic.md`.
4. It asks what one existing table or object is: no playbook. Read `mb table get <id> --include fields --json`, the transform's file and description, and `mb search "<name>" --json` for consumers; answer in plain language; offer to write the description into the transform's file or the table's metadata (`mb skills get metadata`).
5. It asks to change, add, or dispute a delivered definition or number: the change flow below.
6. It asks to test a transform, or says a transform gets one case wrong: `playbooks/build-clean-tables.md`, steps 4 and 5 on that model only; the case becomes a fixture row before the SQL is touched.
7. It asks for a dashboard: `playbooks/build-dashboards.md`, unless the database has no transforms and no metrics (`mb transform list`, `mb card list --fields id,type`), then say so and start the pipeline at step 9.
8. It asks for a definition, a metric, a segment, a measure, a model, or for Metabot or AI to answer well: `playbooks/build-semantic-layer.md`, same test.
9. It asks for clean tables, or names a goal later than the data's state ("set up analytics for X", "load this and build a dashboard"): the pipeline, thin slice first (below), starting at `playbooks/explore-raw-data.md`.
10. It asks for a number, a list, or a finding: `playbooks/answer-a-question.md`.
11. Otherwise: `playbooks/explore-raw-data.md`.

## Thin slice first

The first pass of any pipeline delivers one headline number end to end: the number the user named first, through explore, build, define, and chart for only the tables it touches, reconciled to any reference the user already quotes, handed back in the first session labelled `Draft`. Widen to the next number only after that hand-back. Scope from the questions backward: a table on no path from a named question to a number is listed with its row count and left raw, not profiled, staged, or checkpointed.

## Change a delivered definition

Find the rule (STATE.md Decisions, the `cfg_<domain>` constants transform, or the metric's query), list what depends on it, show before and after on the last three complete periods, run the transform tests as they stand and add the case that motivated the change, change it in one place by editing its file, update the expectations the rule moved (never delete one), import, run the tagged job, re-gate, re-verify, re-run the plausibility pass on every dashboard found, record the change on the definition's description and in the commit message, and hand back which numbers moved. The full flow: "Own, file, change, retire" in `references/semantic-layer-design.md`; for a transform, "Change a deployed model" in `playbooks/build-clean-tables.md`. A dispute between two owners is a `[CHECKPOINT]` with both readings computed; until answered the published one stands and its description says so.

## Domain references

Load by table-name test, say which fired, and record it as STATE.md `domain`: `references/domains/subscription-revenue.md` when any table name matches invoice, subscription, plan, price, charge, membership, dues, pledge, or recurring gift (recurring money of any kind; the amortisation sections apply only where invoices exist); `references/domains/event-and-registration-data.md` when any matches registration, attendee, session, webinar, response, or survey; `references/domains/product-usage-events.md` when any matches event, activity, usage, login, page view, or workspace. Retention, cohorts, and conformed entities of any kind: `references/entities-and-time.md`.

## Invariants

- Profile before you model; a decision with no query result behind it is a `[CHECKPOINT]` or a `[DECIDED, reversible]` line, never an assumption.
- Every model declares one row per what and its key before it is built, in the transform description; every rule a model carries is pinned by a transform test before the model materialises, and a red test never materialises; every model passes the quality gate before the next; every chain is tagged and scheduled before it is called done.
- Structural checks are not correctness: one headline number is reconciled to an independent figure before it is labelled anything but Draft.
- The incomplete trailing period is a flagged row, not a missing one; rollups and rates read complete periods only.
- Business rules are the user's to decide; conventions are the company's to keep.
- One definition per number: cards aggregate metrics and measures by `entity_id` and never re-derive them.
- Content is files on the branch; a change that is not in a commit did not happen.
- Every stage ends with the five-part hand-back and a browser link; the job ends with the leave-behind document.
