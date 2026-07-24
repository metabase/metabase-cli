---
name: transform-test-plan
description: Derive a comprehensive test plan for transforms and their consuming cards — fixture suites, SQL assertions, hand-derived expected CSVs, and a coverage matrix — from the model's declared design. Covers input partitioning (zero-case, multiplicity, dirty rows), grain / conservation / recomputation / conformance checks, error-vs-warn severity conventions, known-red regression suites, and running the same screens against production tables. Load when the user wants tests planned or written for transforms — "write tests for my transforms", "is my model right", "test plan for this pipeline", "add data quality checks" — whether the model is mid-build or already deployed. Running the tests is the transform-test skill; this one decides what to test.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Planning transform tests

Turn a transform chain — and the cards that read it — into fixture suites that
prove the logic on small known data, assertions that state the model's
invariants, and a coverage matrix showing what's checked and what's
deliberately not. Mechanics (the inputs → fixtures → run loop, `--suite`,
`--source`, card targets) live in the `transform-test` skill
(`mb skills get transform-test`) — load it before writing suite files; never
restate it here.

Every check derives from what the model **declares** — detected from its SQL,
confirmed with its owner — never from conformance to a modeling doctrine. One
plan serves two moments: while the model is **built**, checks pin each design
decision; once **deployed**, the same assertion SQL screens production tables
for anomalies.

## Operating rules

- **Detect, then derive.** Classify what each transform is and which
  conventions it uses (the checklist); derive checks only from that. Star,
  one-big-table, partial denormalization — all fine; never flag a style.
- **Judgment calls go through the checklist.** The session's autonomy setting
  governs which answers you supply yourself and which you bring to the user —
  it never makes the checklist a formality. Every answer you supply yourself
  is recorded in the plan as a stated assumption, paired with the named test
  (assertion file or expected-CSV cell) that enforces it — reversing the
  decision then breaks a test, not a paragraph. And regardless of setting,
  when genuinely unsure, ask — a wrong-but-confident grain poisons every
  downstream check.
- **Expected CSVs are derived by hand** from the fixture story and business
  meaning — never captured from pipeline output, which asserts only that the
  transform equals itself.
- **Batteries stay off until declared structure switches them on.** No
  incremental checks for a full rebuild, no snapshot-density checks without a
  snapshot, no version-history checks without effective/end/current columns.
  An empty section beats a speculative one.

## The procedure

1. **Profile the real inputs**: per table, row count; per column,
   min/max/distinct-count/null incidence; orphan counts across declared links
   (`mb field summary`, `mb query`). Profiling feeds domains, bounds, null
   partitions, and key candidates — and every fixture edge cites the
   real-data condition that warrants it, with its count ("the warehouse has
   67 ship-before-order rows").
2. **Detect.** Read each transform's SQL for: grain candidates (`GROUP BY`
   keys, the joins' driving table), join types (orphan handling), correlated
   aggregates (stored aggregates), `<entity>_<attr>` naming (copies),
   effective/end/current columns (version history), `now()`/`current_date`
   (volatile columns), full-rebuild vs. incremental shape. A transform whose
   grain you cannot state in one phrase is itself a finding — raise it before
   writing any test.
3. **Confirm.** Walk `references/checklist.md` — like `checks.md` below, Read
   it from the directory `mb skills path transform-test-plan` prints (or
   inline both via `mb skills get transform-test-plan --full --max-bytes 0`;
   without `--max-bytes 0` the output is cut). Three stages: classify the
   model, per-table declarations, per-column declarations. Each question
   carries its detection hint; answer autonomously where the hint resolves,
   ask where it doesn't. In build-along mode these are design questions —
   treat an undecided answer as a decision to make together, not a blocker.
4. **Derive.** Route every output table and column through
   `references/checks.md` — declared property → assertion shape, fixture
   implication, CSV convention. Read it in full once per plan; it is the
   plan's content.
5. **Design the fixture cast**: one small shared cast per chain (≈5–10 rows
   per table), human-named rows ("Alice Premium"), every row a named edge —
   zero-case entities for every outer join and aggregation, ≥2-member groups
   for every grouping and join, one dirty row per screenable defect, boundary
   dates. Document it as a table (row → attributes → purpose) in the suites
   README; downstream suites reuse the cast so expected CSVs stay mutually
   derivable.
6. **Hand-derive the expected CSVs**, arithmetic recorded in the README
   (premium: 3 orders / 350.50 / 3.0). Every fixture row's fate appears in
   some expected cell. Pin NULL-vs-0-vs-empty for every zero-case row — that
   cell is the null policy's only enforcement.
7. **Write the suites**, one directory per target:

   ```
   suites/
     README.md            # fixture story, arithmetic, conventions, known quirks
     run-all.sh
     shared/*.sql         # assertions reused verbatim by several suites
     <target-name>/
       suite.yaml         # target, sources, inputs, expected, assertions+severities
       fixtures/*.csv
       assertions/*.sql
       expected.csv
   ```

   Suites are durable deliverables — they live with the project, not in
   `.scratch`. Each assertion file opens with a 1–3 line contract comment:
   the invariant, the failure modes it catches ("catches both dropped orders
   and join fan-out").

   **Reuse assertions across suites.** Chains test end-to-end cheaply, so one
   invariant often applies at several stages — a domain screen on a column
   every stage carries, a sign screen valid for a transform and its card.
   When the SQL is identical, the file lives once in `suites/shared/`,
   referenced as `file: ../shared/<name>.sql` (paths resolve from the suite's
   directory, where runs happen). Share only what is truly identical — a
   "shared" file needing per-suite column renames is worse than two honest
   copies with their own contract comments.
8. **Emit the coverage matrix** in the README: rows = output tables with
   grain; columns = check classes (grain, conservation, recomputation,
   conformance, domains, referential integrity, temporal, screens); cells
   name the covering assertion file or fixture row, or state `gap: <reason>`.
   Scan shared-attribute columns across rows for cross-table agreement
   obligations. Empty cells are honest; silent gaps are not — and that
   includes structurally absent batteries: "no cards yet", "no volatile
   columns" belong in the deliberate-gaps list with their revival condition
   (an end-to-end suite becomes due when the first card is built).
9. **Prove the tests have teeth.** Once per suite: corrupt one expected-CSV
   cell, run, confirm the harness points at exactly that cell; revert. Once
   per chain: perturb one raw-leaf fixture cell, chain-run, confirm exactly
   the declared descendant cells move.
10. **Plan the production screens**: the same assertion SQL with
    `test_output` replaced by the real output table (`mb query`, native).
    Fixture suites stay deterministic and error-leaning — red means wrong
    logic. Live screens — red means the data moved — mirror the suites'
    severity split as two directories: `screens/structural/` (must return
    zero rows: grain, ties, domains, copy agreement across independently
    rebuilt tables) and `screens/anomalies/` (expected to fire: tolerated
    oddities, counts recorded in `baselines.tsv`, drift in either direction
    failing the run). Keep the tiers separate so neither red pollutes the
    other.

## Severity: error, or warn-that-fires

**error** = forbidden; failure fails the run. **warn** = tolerated-but-
surfaced: an oddity the owner lives with (orphan rows, ship-before-order
dates) gets a warn assertion **designed to fire on every run**, a fixture row
guaranteeing the fire, and the real-data count in its comment — the tolerance
stays a conscious choice. A firing warn is not "known-red": reserve that term
for a live-bug suite held red pending a fix (below). Under budget pressure
cut business-rule checks first, then cross-table structure checks; never
single-column screens (domains, ranges, nulls) — cheapest, and the last line.

## When a check exposes a live bug

Non-negotiable: **never soften the suite to green** — expected values state
correct behavior; matching them to buggy output documents the bug as intended
— and **surface the finding with its blast radius at both scales**, fixture
("1530.24 of 1600.74 fixture dollars survive") and warehouse ("908 of 2,050
orders dropped"). What happens next follows the session's terms, not a fixed
protocol: propose and apply the fix now (when the user wants it or the
autonomy setting covers it), or — when the fix must wait — document a
**known-red suite**: red asserting correct behavior, the minimal fix body in
`fix/` (ready for `mb transform update <id> --file`), damage in the README.
Either way, once green the suite stays as the regression guard.

## When the doctrine doesn't apply

The vocabulary follows Kimball's dimensional modeling (grain, additivity,
conformed attributes, slowly changing dimensions) — precise, widely
understood terms. Real models are Kimball-inspired at most; no check may
score adherence:

- Full calendar date dimensions are rare. Never demand one; test date
  *semantics* — ranges, orderings, volatile derivations.
- Surrogate keys are doctrine, natural-key joins are practice. Test whichever
  key the model declares; never flag natural-key joins.
- "No NULL FKs / no NULL attributes" is doctrine routinely dropped. Null
  policy is three independent declarations — measures, attributes, FKs —
  each detected and confirmed, never presumed.
- One-big-table is legitimate: it still has a grain, its copies still need
  agreement checks, its functional dependencies still hold.
- A transform-level `ORDER BY` has no testable effect — output tables carry
  no row order and the expected-CSV diff is order-insensitive by design.
  Flag it as probable dead weight (clustering hints aside); never emit an
  ordering assertion.

## Worked example, condensed

Chain: `orders` + `customers` → *enriched_orders* (order grain; LEFT JOIN
attaches `customer_name`, `tier`) → *fulfillment_by_tier* (tier grain:
`order_count`, `revenue`, `avg_days_to_ship` over a `shipping` join) → card
*Revenue by Tier*.

Cast, 7 orders: two tiers; Alice and Carol with 2 orders each (multiplicity);
two never shipped (zero-case for the shipping join); order 106 shipped before
ordered (real oddity, count cited); order 107's customer_id matches no
customer (orphan).

Derived, per catalog: grain uniqueness on both transforms *and the card*;
row/amount conservation input → output → card; `avg_days_to_ship` recomputed
from components (non-additive — never summed); `tier` domain ⊆ {standard,
premium} at every stage; orphan = keep-with-NULLs → firing warn + expected
row pinning the NULL pass-through; ship-before-order tolerated → second
firing warn with the warehouse count; rounding pinned at the card. Expected
CSVs hand-computed (premium = 3 / 350.50 / 3.0; arithmetic in the README).
The inner-vs-LEFT-join bug this cast catches — unshipped orders silently
dropped from revenue — is what the zero-case rows exist for.

## Don't

- Don't write suite files before reading `transform-test` — the header
  contract, table-id discovery, and `--suite` shape live there.
- Don't capture an expected CSV from the transform's own output — hand-derive
  it or it asserts nothing.
- Don't emit checks for structure the model doesn't declare (snapshot
  density, version history, bridge weights) — an inapplicable battery buries
  real findings.
- Don't let a fixture cast go all-clean — no zero-case, no orphan, no dirty
  row proves the happy path and nothing else; the bugs live in the edges.
- Don't blend fixture suites and production screens into one list — their
  reds mean different things and demand different responses.
- Don't surface bare check-ids ("per C3…") to the user — name the check in
  plain words; the ids are for your cross-referencing, not their reading.
