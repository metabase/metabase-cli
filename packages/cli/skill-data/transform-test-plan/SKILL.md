---
name: transform-test-plan
description: Derive a comprehensive test plan for a transform — the fixture cast, the expectations, hand-derived expected rows, and a coverage matrix — from the model's declared design. Covers input partitioning (zero-case, multiplicity, dirty rows), grain / conservation / recomputation / conformance checks, and known-quirk conventions. Load when the user wants tests planned or written for transforms — "write tests for my transforms", "is my model right", "test plan for this pipeline", "add data quality checks" — whether the model is mid-build or already deployed. The `mb transform-test` command and body shapes live in the `transform` skill; this one decides what to test.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Planning transform tests

Turn a transform into a fixture cast that proves the logic on small known rows, expectations that
state the model's invariants, and a coverage matrix showing what's checked and what's deliberately
not. Mechanics — the `inputs`/`expectations` body shape and every `mb transform-test` verb — live in
the `transform` skill (`mb skills get transform`); load it before authoring, and never restate it
here.

Every check derives from what the model **declares** — detected from its SQL, confirmed with its
owner — never from conformance to a modeling doctrine. One plan serves two moments: while the model
is **built**, checks pin each design decision; once **deployed**, the same SQL screens production
tables for anomalies.

## Operating rules

- **Detect, then derive.** Classify what the transform is and which conventions it uses (the
  checklist); derive checks only from that. Star, one-big-table, partial denormalization — all
  fine; never flag a style.
- **Judgment calls go through the checklist.** The session's autonomy setting governs which answers
  you supply yourself and which you bring to the user — it never makes the checklist a formality.
  Every answer you supply yourself is recorded in the plan as a stated assumption, paired with the
  named expectation that enforces it — reversing the decision then breaks a test, not a paragraph.
  And regardless of setting, when genuinely unsure, ask — a wrong-but-confident grain poisons every
  downstream check.
- **Expected rows are derived by hand** from the fixture story and business meaning — never captured
  from the transform's output, which asserts only that the transform equals itself.
- **Batteries stay off until declared structure switches them on.** No snapshot-density checks
  without a snapshot, no version-history checks without effective/end/current columns. An empty
  section beats a speculative one.

## The procedure

1. **Profile the real inputs**: per table, row count; per column, min/max/distinct-count/null
   incidence; orphan counts across declared links (`mb field summary`, `mb query`). Profiling feeds
   domains, bounds, null partitions, and key candidates — and every fixture edge cites the real-data
   condition that warrants it, with its count ("the warehouse has 67 ship-before-order rows").
2. **Detect.** Read the transform's SQL (`mb transform get <id> --full --json`) for: grain
   candidates (`GROUP BY` keys, the joins' driving table), join types (orphan handling), correlated
   aggregates (stored aggregates), `<entity>_<attr>` naming (copies), effective/end/current columns
   (version history), `now()`/`current_date` (volatile columns). A transform whose grain you cannot
   state in one phrase is itself a finding — raise it before writing any test.
3. **Confirm.** Walk [references/checklist.md](references/checklist.md). Three stages: classify the
   model, per-table declarations, per-column declarations. Each question carries its detection hint;
   answer autonomously where the hint resolves, ask where it doesn't. In build-along mode these are
   design questions — treat an undecided answer as a decision to make together, not a blocker.
4. **Derive.** Route every output column through [references/checks.md](references/checks.md) —
   declared property → expectation shape, fixture implication, expected-row convention. Read it in
   full once per plan; it is the plan's content.
5. **Design the fixture cast**: one small cast per transform (≈5–10 rows per table), human-named
   rows ("Alice Premium"), every row a named edge — zero-case entities for every outer join and
   aggregation, ≥2-member groups for every grouping and join, one dirty row per screenable defect,
   boundary dates. Document it as a table (row → attributes → purpose) in the plan.

   Write each input as `format: "rows"` — the columns and their values _are_ the cast, and the story
   stays readable in the body. Reach for `format: "sql"` only when the cast is genuinely easier as a
   query — a generated series, say.

   Every column carries a `cast_type`: the target its cells are cast to, which answers to the
   warehouse's `CAST` grammar rather than naming one of its column types. MySQL casts to `SIGNED`
   and reports the column as `INTEGER`; ClickHouse takes `Nullable(Int32)` where the column is
   `Int64`. So a cast type is a per-warehouse choice — a cast written for one engine does not carry
   to another, and the `database_type` a run reports is the output column's real type, never a
   `cast_type` to paste back.

6. **Hand-derive the expected rows**, arithmetic recorded in the plan (premium: 3 orders / 350.50 /
   3.0). Every fixture row's fate appears in some expected cell. Pin NULL-vs-0-vs-empty for every
   zero-case row — that cell is the null policy's only enforcement.
7. **Author the test.** One test per transform, per coherent story: an `equals` pinning the output,
   and `empty` expectations stating the invariants that survive a change to the cast.

   ```bash
   mb transform-test create --file ./.scratch/orders-test.json --profile <n> --json
   mb transform-test run <id> --profile <n> --json
   ```

   Iterate with `mb transform-test update <id> --file`, never delete + create — the same rule the
   `transform` skill states for transforms, and for the same reasons: the row, its `entity_id` and
   its YAML filename all survive.

   Tests live with the transform: they serialize and git-sync with it. Give each expectation a name that states the invariant, because the name is what a
   failure leads with ("revenue never negative", not "check 3"), and open each `empty` expectation's
   SQL with a `--` contract comment: the invariant, and the failure modes it catches ("catches both
   dropped orders and join fan-out").

   Where one invariant applies to several transforms, duplicate the SQL. Nothing is shared between
   tests, so give each copy its own name and comment rather than one that only makes sense next to
   its twin.

8. **Emit the coverage matrix** in the plan: rows = output columns with the table's grain; columns =
   check classes (grain, conservation, recomputation, conformance, domains, referential integrity,
   temporal, screens); cells name the covering expectation or expected-row cell, or state
   `gap: <reason>`. Scan shared-attribute columns across transforms for cross-table agreement
   obligations. Empty cells are honest; silent gaps are not.
9. **Prove the tests have teeth.** Once per test: corrupt one expected cell, `run`, confirm
   `cell-mismatches` names exactly that column; revert. Then perturb one input cell and confirm
   exactly the declared output cells move. Every `empty` expectation passes against an empty output,
   so a green test can still be vacuous.

## Severity: error, or the tolerated oddity

Every expectation is pass or fail, and one failure fails the run — `run` exits non-zero, so a test
is a CI gate. **error** = forbidden, and it becomes an `empty` expectation. There is no warn
severity, so **never author an expectation you expect to fire**: a permanently red test trains
everyone to ignore the result and holds the gate down for everyone else.

A tolerated-but-surfaced oddity — one the owner lives with, like orphan rows or ship-before-order
dates — gets encoded the two ways that hold: **pin it in the `equals` rows** (an orphan passing
through with NULLs is a cell in the expected output, so reversing the tolerance breaks the test),
and **record it in the plan's known-quirks list** with its real-data count, so the tolerance stays a
conscious choice.

Under budget pressure cut business-rule checks first, then cross-table structure checks; never
single-column screens (domains, ranges, nulls) — cheapest, and the last line.

## When a check exposes a live bug

Non-negotiable: **never soften the test to green** — expected values state correct behavior; matching
them to buggy output documents the bug as intended — and **surface the finding with its blast radius
at both scales**, fixture ("1530.24 of 1600.74 fixture dollars survive") and warehouse ("908 of
2,050 orders dropped"). What happens next follows the session's terms, not a fixed protocol: propose
and apply the fix now (when the user wants it or the autonomy setting covers it), or — when the fix
must wait — hold the correct expectation and record the red in the plan with the minimal fix body,
ready for `mb transform update <id> --file`. A stored test has no red-by-design state, so a deferred
fix must be visible in the plan or the test reads as broken. Either way, once green the test stays
as the regression guard.

## When the doctrine doesn't apply

The vocabulary follows Kimball's dimensional modeling (grain, additivity, conformed attributes,
slowly changing dimensions) — precise, widely understood terms. Real models are Kimball-inspired at
most; no check may score adherence:

- Full calendar date dimensions are rare. Never demand one; test date _semantics_ — ranges,
  orderings, volatile derivations.
- Surrogate keys are doctrine, natural-key joins are practice. Test whichever key the model
  declares; never flag natural-key joins.
- "No NULL FKs / no NULL attributes" is doctrine routinely dropped. Null policy is three independent
  declarations — measures, attributes, FKs — each detected and confirmed, never presumed.
- One-big-table is legitimate: it still has a grain, its copies still need agreement checks, its
  functional dependencies still hold.
- A transform-level `ORDER BY` has no testable effect — output tables carry no row order and the
  `equals` comparison is a multiset. Flag it as probable dead weight (clustering hints aside); never
  write an ordering expectation.

## One transform at a time

Each test covers one transform. When the transform under test reads another transform's output,
that target table is an input like any other: declare it and fake it. Derive those rows from the
base transform's own expected output, so the two tests tell one story, and note the coupling in both
plans — changing the base's expected rows means changing this test's input.

## Worked example, condensed

`orders` + `customers` → _enriched_orders_ (order grain; LEFT JOIN attaches `customer_name`,
`tier`).

Cast, 7 orders: two tiers; Alice and Carol with 2 orders each (multiplicity); two never shipped
(zero-case for the shipping join); order 106 shipped before ordered (real oddity, count cited);
order 107's customer_id matches no customer (orphan). Two `rows` inputs, one per source table.

Derived, per catalog: grain uniqueness on `order_id`; row and amount conservation from input to
output, as scalar subqueries over the target and the seeded input; `tier` domain ⊆ {standard,
premium}; orphan = keep-with-NULLs → an expected row pinning the NULL pass-through; ship-before-order
tolerated → the plan's known-quirks list with the warehouse count. The whole output pinned in one
`equals`, hand-computed, arithmetic in the plan. The inner-vs-LEFT-join bug this cast catches —
unshipped orders silently dropped from revenue — is what the zero-case rows exist for.

## Don't

- Don't author expectations before loading the `transform` skill — the body shape, the closed
  create/update contract, and the verb flags live there.
- Don't capture expected rows from the transform's own output — hand-derive them or they assert
  nothing.
- Don't emit checks for structure the model doesn't declare (snapshot density, version history,
  bridge weights) — an inapplicable battery buries real findings.
- Don't let a fixture cast go all-clean — no zero-case, no orphan, no dirty row proves the happy
  path and nothing else; the bugs live in the edges.
- Don't write an expectation you expect to fail.
- Don't name a table in an `empty` expectation that is neither the transform's target nor a declared
  input. Only those two are rewritten to temp tables; anything else is left exactly as written and
  reads the real table.
- Don't surface bare check-ids ("per C3…") to the user — name the check in plain words; the ids are
  for your cross-referencing, not their reading.
