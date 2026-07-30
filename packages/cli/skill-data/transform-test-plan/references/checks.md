# Check catalog

Every check the plan can derive, grouped by theme. Per entry: **when it
applies** (the declared property that switches it on — blank means always),
**assert** (the SQL shape or convention), and **fixtures** (what the cast must
contain for the check to have teeth). Assertion SQL reads the target's output
as `test_output` and the seeded input tables under their real names, so
per-row recomputation joins against inputs are always writable.

Ids (G1, A2, …) are for cross-referencing within the plan documents only —
never surface them to the user bare.

## Grain & keys

**G1 — Declared grain.** Every output table states "one row per X"; the
declaration anchors every other check.

- Applies: always. Elicit or detect (GROUP BY keys; the join's driving table).
- Assert: nothing directly — G1 is the plan's opening move. A table with no
  statable grain, or a grain stated inconsistently between docs and SQL, is a
  finding before any SQL runs.
- Fixtures: the grain declaration decides the cast's row structure.

**G2 — Grain-key uniqueness.** The grain key stays a key; doubles as the
fan-out guard for every enriching join.

- Applies: always — one-big-table, rollups, and stars all have a grain.
- Assert (error): `SELECT <grain cols>, COUNT(*) FROM test_output GROUP BY
<grain cols> HAVING COUNT(*) > 1`. NULL grain values form their own bucket.
  Emit for every target — transforms _and_ cards.
- Fixtures: a parent with ≥2 children on every join (I4) is what makes this
  check able to fail.

## Additivity & reconciliation

**A1 — Measure additivity classification.** Additive / semi-additive
(balances) / non-additive (ratios, rates, unit prices) decides which
aggregations are valid tests.

- Applies: every numeric measure; per-column declaration.
- Assert: routes the measure — additive → A2; semi-additive → sum across
  non-time slices only (a test summing a balance over time is a bug in the
  plan); non-additive → A3 recomputation, never reconciled by summing.
- Fixtures: none directly; one coverage-matrix axis (measure × valid
  aggregation set).

**A2 — Conservation reconciliation.** Row counts and additive-measure sums tie
from input to output; catches dropped rows and join double-counting at once.

- Applies: per declared tie (which input, which declared exclusions).
- Assert (error): independent scalar subqueries compared with
  `IS DISTINCT FROM`, returning the mismatched pair:
  `SELECT (SELECT SUM(t.m) FROM test_output t) AS output_sum,
(SELECT SUM(s.m) FROM <input> s) AS input_sum WHERE (…) IS DISTINCT FROM (…)`.
  Never reconcile via a fact-to-fact join — cardinality is uncontrollable and
  wrong results are silent. For chains, span raw leaf → final output → card.
  Where the source has a published authoritative aggregate (an official total),
  also tie the pipeline's headline figure to it — an out-of-band check no
  internal bug can satisfy by accident; it validates the semantic reading of
  the grain, not just the plumbing.
- Fixtures: amounts chosen so partial survival is visible (distinct values,
  odd cents).

**A3 — Derived-measure recomputation.** Averages, lags, ratios, rounded
presentations recompute from their components per row.

- Applies: every derived column, with its declared rule (rounding, business-day
  adjustment, NULL handling).
- Assert (error): `SELECT <key> FROM test_output t WHERE t.<derived>
IS DISTINCT FROM <recomputation from inputs or sibling columns>`.
  Presentation rules (round to n decimals) are the same shape at the card.
- Fixtures: component values whose derivation is non-trivial (a NULL in the
  AVG, a negative lag).

**A4 — Stored aggregates on entity tables.** Lifetime/rollup stats carried on
an entity-grain table (lifetime*orders, review_count, first_order_date) equal
recomputation from detail — per row \_and* in total.

- Applies: columns detected as correlated aggregates over a detail table.
- Assert (error), two per column: per-row — `WHERE t.<agg> IS DISTINCT FROM
(SELECT COUNT(*)/SUM(…)/MIN(…) FROM <detail> d WHERE d.<fk> = t.<key>)`;
  total — the A2 scalar-pair shape. Totals alone cancel offsetting per-row
  errors; the per-row form is the one that catches them.
- Fixtures: an entity with several detail rows and an entity with none (I3/I4).

**A5 — Rollup consistency via chain tests.** A layered rollup always agrees
with its base; fixtures live at raw leaves only.

- Applies: any transform reading another transform's output.
- Assert: suite `sources:` names the parent(s); every rollup measure equals
  the corresponding aggregation over the (scratch) base (A2 shape); group-set
  equality both directions — `SELECT <group> FROM test_output EXCEPT SELECT
DISTINCT <group col> FROM <base>` and the reverse, filtered by the declared
  zero-group policy.
- Fixtures: raw-leaf cast only; a group with no contributing rows pins the
  zero-group policy.

## Fact-table type & load mode

**F1 — Full-rebuild vs. incremental.** One branch switching a whole battery.

- Applies: per transform, always classified.
- Full rebuild: battery off; rerun determinism is free.
- Incremental adds: duplicate-delivery fixture (same source row twice → no
  double count), gap fixture (skipped period → declared behavior),
  late-arrival fixture (fact before its dimension row → declared behavior),
  no-op-change fixture (identical rewrite → no new version), rerun idempotency
  (run twice → identical output).

**F2 — Fact-table type bundle.** Transaction / periodic snapshot /
accumulating snapshot each carry a distinct invariant set.

- Applies: per fact-shaped output, always classified; **transaction** needs
  nothing beyond G2 + A2 (sparsity is legitimate).
- Periodic snapshot, if declared _dense_: `COUNT(*) = |entities| × |periods|`
  (or the declared subset); per-entity gap detection in the period series;
  inactive-period representation (zero vs NULL) pinned in the expected CSV.
  If sparse, density checks off — the one yes/no flips the whole set.
- Accumulating snapshot: milestone dates monotone in pipeline order where set
  (`WHERE <later> < <earlier>` per adjacent pair); unset-milestone default
  (NULL vs sentinel) pinned in expected CSV; completion flags ∈ {0,1} and
  consistent with their date's set-ness; lags via A3.
- Fixtures (accumulating): occurrences at every completion stage — none, some,
  all milestones.

## Conformance & domains

**C1 — Denormalized-copy agreement.** Every copied attribute agrees with the
owning table's value for that key.

- Applies: columns declared as copies (detect: `<entity>_<attr>` naming; any
  column functionally dependent on a non-grain key). Each such column must be
  a declared copy (this check), a stored aggregate (A4), or it's a smuggled
  coarser-grain fact — a finding: it double-counts under summation.
- Assert (error): `SELECT t.<key>, t.<copy>, d.<attr> FROM test_output t JOIN
<owning table> d ON t.<key> = d.<key> WHERE t.<copy> IS DISTINCT FROM
d.<attr>` — one file per owning table, columns UNION ALL'd if preferred.
- Scope: inside a chain test the copies are produced by the very join under
  test, so this join-form is near-tautological there — the C4
  functional-dependency form plus expected-CSV cell pinning carries the suite.
  The join-form against the independently materialized owning table is the
  _drift_ check: it belongs in the production screens whenever the tables
  rebuild independently.
- Fixtures: copies with distinct values per entity so a crossed join is
  visible.

**C2 — Closed-domain screen.** A categorical column's values stay inside the
declared enumeration.

- Applies: per column declared closed (detect from profiling / `mb field
values`; confirm the set and whether NULL is a member).
- Assert (error): `SELECT <key>, <col> FROM test_output WHERE <col> IS NOT
NULL AND <col> NOT IN (<domain>)`.
- Fixtures: every domain value represented where practical; one out-of-domain
  input row if the source can produce one (I5).

**C3 — Referential integrity / orphan policy.** Every FK resolves, or the
declared orphan handling is pinned and surfaced.

- Applies: per join, conditioned on the declared response — drop /
  keep-with-NULLs / default row; tolerated or forbidden.
- Assert, strict (error): `SELECT t.<fk> FROM test_output t LEFT JOIN <dim> d
ON t.<fk> = d.<key> WHERE t.<fk> IS NOT NULL AND d.<key> IS NULL`.
  Tolerated (warn, fires by design): select the orphan rows (`WHERE
t.<copied attr> IS NULL`), plus the expected CSV pinning the pass-through.
  Default-row convention adds: distinct unknown keys must not collapse into
  one output row.
- Fixtures: one orphan row (I5). Without it the join direction is untested —
  an inner join silently dropping unmatched rows is the classic bug this
  catches.

**C4 — Many-to-one consistency.** Each declared many-to-one edge holds within
the output (product → one category; zip → one state).

- Applies: per declared edge; where an owning table is in scope, C1 subsumes
  it — this is the one-big-table variant with nothing to join against.
- Assert (error): `SELECT t.<many>, COUNT(DISTINCT t.<one>) FROM test_output t
GROUP BY t.<many> HAVING COUNT(DISTINCT t.<one>) > 1`.
- Fixtures: a violating input row if the source can produce one (I5), pinning
  the transform's behavior on dirty input.

## Temporal & version history

**T1 — Change handling per attribute.** How the model treats a changed source
attribute decides the temporal fixtures.

- Applies: detect effective/end/current housekeeping columns.
- Present → version-history battery (error): per durable key exactly one
  current row; `effective < end` per row; intervals contiguous and
  non-overlapping; current row's end = the declared far-future default; fact
  rows join the version whose interval contains the fact date.
- Absent → confirm overwrite-everywhere as a stated assumption (history is
  silently rewritten in rollups), and derive the propagation probe: change an
  attribute in a leaf fixture, chain-run, assert every downstream rollup
  regrouped — a full rebuild does this for free; assert it.
- Fixtures: a before/after change pair; for version history, an entity with
  ≥2 versions and a fact row dated inside each interval.

**T2 — Date-pair ordering.** Business-guaranteed orderings asserted; known
violations surfaced.

- Applies: per declared date pair (ordered ≤ shipped ≤ delivered; signup ≤
  first order), each classified guaranteed vs. tolerated-violated.
- Assert: guaranteed (error) — `SELECT <key>, <earlier>, <later> FROM
test_output WHERE <later> < <earlier>`. Tolerated (warn, fires by design) —
  same shape, with the real-data count in the contract comment.
- Fixtures: one violating row for every tolerated ordering, its downstream
  arithmetic (a negative lag inside an average) pinned in the expected CSV.

**T3 — Volatile columns.** Values that change across runs can't sit in an
expected CSV.

- Applies: columns derived from `now()`/`current_date` (age), run metadata
  (load timestamps, batch ids).
- Assert: route the column to `ignore_columns` in the suite; separately
  assert its form where warranted (error): `WHERE age NOT BETWEEN 0 AND 120`
  — assertions still see ignored columns. The stable source column
  (birth_date) stays exact in the expected CSV.
- Fixtures: none special; the split is the point — ignore the volatile,
  assert the stable.

## Screens & severity

**Q1 — Range / sign screens.** Each measure's declared bounds hold.

- Applies: per bounded measure; bounds from business meaning plus profiling
  (derived bounds are free: a sum of non-negatives is non-negative).
- Assert (error): `SELECT <key>, <col> FROM test_output WHERE <col> < <lo> OR
  <col> > <hi>` (one-sided where only one bound exists).
- Fixtures: boundary values where the bound is business-set.

**Q2 — Null policy, three ways.** Measures, descriptive attributes, and FKs
carry independent null policies; never presume one from another.

- Applies: per column, asked separately — "count of nothing": 0 or NULL?
  empty date: NULL or sentinel? FK: see C3.
- Assert: declared non-null columns get `WHERE <col> IS NULL` (error).
  Otherwise the policy is enforced by the expected CSV cell of a zero-case
  fixture row — NULL vs 0 vs empty is invisible until a fixture forces the
  choice into a cell.
- Fixtures: the zero-case row (I3) is the enforcement mechanism.

**Q3 — Severity & contract comments.** Every assertion declares its meaning.

- Applies: always, every assertion.
- Convention: `severity: error` = forbidden; `severity: warn` = tolerated,
  surfaced, and — where the oddity exists in real data — _designed to fire on
  every run_, with a fixture row guaranteeing it and the warehouse count in
  the comment. Every assertion file opens with 1–3 comment lines naming the
  invariant and the failure modes it catches. Budget cuts drop business-rule
  checks first, then cross-table structure checks, never single-column
  screens.

## Input modeling (fixture-design rules)

**I1 — Profiling-derived partitions.** Fixture edges and tolerated non-ties
cite profiled reality with counts; the plan's known-quirks section carries
each tolerated oddity with its reason and count.

**I2 — Shared fixture cast.** One small human-named cast per chain, every row
a named edge, documented as a story table (row → attributes → purpose) in the
suites README; downstream suites reuse it so expected CSVs stay mutually
derivable.

**I3 — Zero-case partitions.** For every outer join and aggregation relation:
one entity with zero matches. Its expected row pins the absence
representation (Q2) and the join direction (C3) — the all-clean cast is the
single most common cause of vacuous suites. When the schema distinguishes
states the profiled data never exhibits (a literal zero in a source that only
has NULLs and positives), fixture the missing state — nothing else forces it
onto an expected cell.

**I4 — Multiplicity partitions.** Every aggregation gets a >1-member group and
an exactly-1 group (the 0 case is I3); every join gets a parent with ≥2
children. Expected values then differ from any single row's, so copy-through
bugs can't pass.

**I5 — Dirty-input pinning.** Per screenable defect the source can carry
(orphan FK, out-of-domain value, duplicate natural key, hierarchy violation,
ordering violation): one fixture row exhibiting it, an expected row pinning
the transform's response (drop / pass-through / default), and the matching
warn or error assertion. Which duplicate survives a dedupe is invisible until
a conflicting-duplicate fixture pins it.

**I6 — Mutation probes.** Run at plan-validation time, not in every suite:
corrupt one expected-CSV cell → the harness must point at that exact cell;
perturb one raw-leaf fixture cell → exactly the declared descendant cells
move. Both guard against vacuous tests.

## Plan-level artifacts

**P1 — Coverage matrix.** Output tables (with grain) × check classes; cells
name the covering assertion/fixture or state `gap: <reason>`; shared-attribute
columns scanned across rows for agreement obligations (C1).

**P2 — Hand-derived expected CSVs.** From the fixture story and business
meaning, arithmetic recorded in the README; never captured from output; every
fixture row's fate appears in some expected cell.

**P3 — Live-bug handling.** A check failing against a deployed transform is a
real finding: never soften the suite to green; quantify the damage at fixture
and warehouse scale. Then fix now, or document as a known-red suite (red
until the fix lands, minimal fix body in `fix/`, damage in the README) — per
the session's terms. Once green, the suite stays as the regression guard.

**P4 — Card-level end-to-end suites.** Per key consuming card: `target:
{type: card}`, `sources:` the full chain, fixtures at raw leaves only,
hand-derived expected CSV, end-to-end conservation (A2), grain uniqueness on
the card output (G2), presentation rules (A3). The card is where the user
actually looks; a chain green everywhere but wrong at the card is still wrong.

**P5 — Anomaly baselines.** Every expected-to-fire live screen records its
current count (`screens/baselines.tsv`: screen → count), and the screen
runner fails on drift in _either_ direction — a tolerance silently growing
and one silently vanishing both surface. This machine-checks the known-quirks
counts (I1) and gives warn-fires-by-design (Q3) live-mode teeth: the warn now
fires _at the recorded rate_. A changed baseline is a finding to investigate,
then re-record deliberately.
