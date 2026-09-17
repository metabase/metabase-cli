# Check catalog

Every check the plan can derive, grouped by theme. Per entry: **when it applies** (the declared
property that switches it on — blank means always), **assert** (the expectation shape), and
**fixtures** (what the input cast must contain for the check to have teeth).

Expectation SQL names the transform's **target table** and its **declared input tables** under their
real names; both are rewritten to the run's temp tables, so per-row recomputation joins against
inputs are writable. Anything else you name is left exactly as written and reads the real table.

Ids (G1, A2, …) are for cross-referencing within the plan documents only — never surface them to the
user bare.

Throughout, `<target>` stands for the transform's target table as written in the transform's own
definition, and `<input>` for a declared input table.

## Grain & keys

**G1 — Declared grain.** Every output table states "one row per X"; the declaration anchors every
other check.

- Applies: always. Elicit or detect (GROUP BY keys; the join's driving table).
- Assert: nothing directly — G1 is the plan's opening move. A table with no statable grain, or a
  grain stated inconsistently between docs and SQL, is a finding before any SQL runs.
- Fixtures: the grain declaration decides the cast's row structure.

**G2 — Grain-key uniqueness.** The grain key stays a key; doubles as the fan-out guard for every
enriching join.

- Applies: always — one-big-table, rollups, and stars all have a grain.
- Assert (`empty`): `SELECT <grain cols>, COUNT(*) FROM <target> GROUP BY <grain cols> HAVING
COUNT(*) > 1`. NULL grain values form their own bucket.
- Fixtures: a parent with ≥2 children on every join (I4) is what makes this check able to fail.

## Additivity & reconciliation

**A1 — Measure additivity classification.** Additive / semi-additive (balances) / non-additive
(ratios, rates, unit prices) decides which aggregations are valid tests.

- Applies: every numeric measure; per-column declaration.
- Assert: routes the measure — additive → A2; semi-additive → sum across non-time slices only (a
  test summing a balance over time is a bug in the plan); non-additive → A3 recomputation, never
  reconciled by summing.
- Fixtures: none directly; one coverage-matrix axis (measure × valid aggregation set).

**A2 — Conservation reconciliation.** Row counts and additive-measure sums tie from input to output;
catches dropped rows and join double-counting at once.

- Applies: per declared tie (which input, which declared exclusions).
- Assert (`empty`): independent scalar subqueries compared with `IS DISTINCT FROM`, returning the
  mismatched pair:
  `SELECT (SELECT SUM(t.m) FROM <target> t) AS output_sum, (SELECT SUM(s.m) FROM <input> s) AS
input_sum WHERE (…) IS DISTINCT FROM (…)`.
  Never reconcile via a fact-to-fact join — cardinality is uncontrollable and wrong results are
  silent.
- Fixtures: amounts chosen so partial survival is visible (distinct values, odd cents).

**A3 — Derived-measure recomputation.** Averages, lags, ratios, rounded presentations recompute from
their components per row.

- Applies: every derived column, with its declared rule (rounding, business-day adjustment, NULL
  handling).
- Assert (`empty`): `SELECT <key> FROM <target> t WHERE t.<derived> IS DISTINCT FROM <recomputation
from inputs or sibling columns>`.
- Fixtures: component values whose derivation is non-trivial (a NULL in the AVG, a negative lag).

**A4 — Stored aggregates on entity tables.** Lifetime/rollup stats carried on an entity-grain table
(`lifetime_orders`, `review_count`, `first_order_date`) equal recomputation from detail — per row
_and_ in total.

- Applies: columns detected as correlated aggregates over a detail table.
- Assert (`empty`), two per column: per-row — `WHERE t.<agg> IS DISTINCT FROM (SELECT
COUNT(*)/SUM(…)/MIN(…) FROM <detail> d WHERE d.<fk> = t.<key>)`; total — the A2 scalar-pair shape.
  Totals alone cancel offsetting per-row errors; the per-row form is the one that catches them.
- Fixtures: an entity with several detail rows and an entity with none (I3/I4).

**A5 — Rollup consistency.** A layered rollup always agrees with its base.

- Applies: any transform reading another transform's output. The base is a declared input like any
  other, faked with rows taken from the base transform's own expected output.
- Assert (`empty`): every rollup measure equals the corresponding aggregation over the base (A2
  shape); group-set equality both directions — `SELECT <group> FROM <target> EXCEPT SELECT DISTINCT
<group col> FROM <base>` and the reverse, filtered by the declared zero-group policy.
- Fixtures: a group with no contributing rows pins the zero-group policy.

## Fact-table type

**F2 — Fact-table type bundle.** Transaction / periodic snapshot / accumulating snapshot each carry
a distinct invariant set.

- Applies: per fact-shaped output, always classified; **transaction** needs nothing beyond G2 + A2
  (sparsity is legitimate).
- Periodic snapshot, if declared _dense_: `COUNT(*) = |entities| × |periods|` (or the declared
  subset); per-entity gap detection in the period series; inactive-period representation (zero vs
  NULL) pinned in the expected rows. If sparse, density checks off — the one yes/no flips the whole
  set.
- Accumulating snapshot: milestone dates monotone in pipeline order where set (`WHERE <later> <
<earlier>` per adjacent pair); unset-milestone default (NULL vs sentinel) pinned in the expected
  rows; completion flags ∈ {0,1} and consistent with their date's set-ness; lags via A3.
- Fixtures (accumulating): occurrences at every completion stage — none, some, all milestones.

## Conformance & domains

**C1 — Denormalized-copy agreement.** Every copied attribute agrees with the owning table's value
for that key.

- Applies: columns declared as copies (detect: `<entity>_<attr>` naming; any column functionally
  dependent on a non-grain key). Each such column must be a declared copy (this check), a stored
  aggregate (A4), or it's a smuggled coarser-grain fact — a finding: it double-counts under
  summation.
- Assert (`empty`): `SELECT t.<key>, t.<copy>, d.<attr> FROM <target> t JOIN <owning input> d ON
t.<key> = d.<key> WHERE t.<copy> IS DISTINCT FROM d.<attr>`.
- Scope: in a test, the copies are produced by the very join under test, so this join-form is near-
  tautological — the C4 functional-dependency form plus expected-row cell pinning carries the test.
  The join-form against an independently materialized owning table is the _drift_ check, which
  belongs to whatever screens the deployed tables.
- Fixtures: copies with distinct values per entity so a crossed join is visible.

**C2 — Closed-domain screen.** A categorical column's values stay inside the declared enumeration.

- Applies: per column declared closed (detect from profiling; confirm the set and whether NULL is a
  member).
- Assert (`empty`): `SELECT <key>, <col> FROM <target> WHERE <col> IS NOT NULL AND <col> NOT IN
(<domain>)`.
- Fixtures: every domain value represented where practical; one out-of-domain input row if the
  source can produce one (I5).

**C3 — Referential integrity / orphan policy.** Every FK resolves, or the declared orphan handling is
pinned.

- Applies: per join, conditioned on the declared response — drop / keep-with-NULLs / default row;
  tolerated or forbidden.
- Assert, forbidden (`empty`): `SELECT t.<fk> FROM <target> t LEFT JOIN <dim input> d ON t.<fk> =
d.<key> WHERE t.<fk> IS NOT NULL AND d.<key> IS NULL`.
  Tolerated: not an expectation — pin the orphan's pass-through as a row in the `equals` (NULL in
  the copied attributes), and record the tolerance with its warehouse count in the plan.
  Default-row convention adds: distinct unknown keys must not collapse into one output row.
- Fixtures: one orphan row (I5). Without it the join direction is untested — an inner join silently
  dropping unmatched rows is the classic bug this catches.

**C4 — Many-to-one consistency.** Each declared many-to-one edge holds within the output (product →
one category; zip → one state).

- Applies: per declared edge; where an owning table is in scope, C1 subsumes it — this is the
  one-big-table variant with nothing to join against.
- Assert (`empty`): `SELECT t.<many>, COUNT(DISTINCT t.<one>) FROM <target> t GROUP BY t.<many>
HAVING COUNT(DISTINCT t.<one>) > 1`.
- Fixtures: a violating input row if the source can produce one (I5), pinning the transform's
  behavior on dirty input.

## Temporal & version history

**T1 — Change handling per attribute.** How the model treats a changed source attribute decides the
temporal fixtures.

- Applies: detect effective/end/current housekeeping columns.
- Present → version-history battery (`empty` each): per durable key exactly one current row;
  `effective < end` per row; intervals contiguous and non-overlapping; current row's end = the
  declared far-future default; fact rows join the version whose interval contains the fact date.
- Absent → confirm overwrite-everywhere as a stated assumption (history is silently rewritten in
  rollups), and derive the propagation probe: change an attribute in an input, run, assert the
  output regrouped.
- Fixtures: a before/after change pair; for version history, an entity with ≥2 versions and a fact
  row dated inside each interval.

**T2 — Date-pair ordering.** Business-guaranteed orderings asserted; known violations recorded.

- Applies: per declared date pair (ordered ≤ shipped ≤ delivered; signup ≤ first order), each
  classified guaranteed vs. tolerated-violated.
- Assert: guaranteed (`empty`) — `SELECT <key>, <earlier>, <later> FROM <target> WHERE <later> <
<earlier>`. Tolerated — pin the violating row's downstream arithmetic (a negative lag inside an
  average) in the expected rows, and record the real-data count in the plan.
- Fixtures: one violating row for every tolerated ordering.

**T3 — Volatile columns.** Values that change across runs can't be pinned.

- Applies: columns derived from `now()`/`current_date` (age), run metadata (load timestamps, batch
  ids).
- Assert: leave the column out of the `equals` `columns` list — an undeclared column never enters the
  comparison. Separately assert its form where warranted (`empty`): `WHERE age NOT BETWEEN 0 AND
120`. The stable source column (`birth_date`) stays exact in the expected rows.
- Fixtures: none special; the split is the point — omit the volatile, pin the stable.

## Screens & severity

**Q1 — Range / sign screens.** Each measure's declared bounds hold.

- Applies: per bounded measure; bounds from business meaning plus profiling (derived bounds are
  free: a sum of non-negatives is non-negative).
- Assert (`empty`): `SELECT <key>, <col> FROM <target> WHERE <col> < <lo> OR <col> > <hi>` (one-sided
  where only one bound exists).
- Fixtures: boundary values where the bound is business-set.

**Q2 — Null policy, three ways.** Measures, descriptive attributes, and FKs carry independent null
policies; never presume one from another.

- Applies: per column, asked separately — "count of nothing": 0 or NULL? empty date: NULL or
  sentinel? FK: see C3.
- Assert: declared non-null columns get `WHERE <col> IS NULL` (`empty`). Otherwise the policy is
  enforced by the expected-row cell of a zero-case fixture row — NULL vs 0 vs empty is invisible
  until a fixture forces the choice into a cell.
- Fixtures: the zero-case row (I3) is the enforcement mechanism.

**Q3 — Naming & the tolerated oddity.** Every expectation declares its meaning.

- Applies: always, every expectation.
- Convention: the expectation's `name` states the invariant in plain words, because a failure leads
  with it. Each `empty` SQL opens with 1–3 comment lines naming the invariant and the failure modes
  it catches. Budget cuts drop business-rule checks first, then cross-table structure checks, never
  single-column screens.
- A forbidden condition is an `empty` expectation. A tolerated one is pinned in the expected rows
  and recorded in the plan's known-quirks list with its warehouse count. Never author an expectation
  designed to fire.

## Input modeling (fixture-design rules)

**I1 — Profiling-derived partitions.** Fixture edges and tolerated non-ties cite profiled reality
with counts; the plan's known-quirks section carries each tolerated oddity with its reason and
count.

**I2 — Shared fixture cast.** One small human-named cast per transform, every row a named edge,
documented as a story table (row → attributes → purpose) in the plan. Where one transform's output
is another's input, derive the faked rows from the first's expected output so the two tests tell one
story.

**I3 — Zero-case partitions.** For every outer join and aggregation relation: one entity with zero
matches. Its expected row pins the absence representation (Q2) and the join direction (C3) — the
all-clean cast is the single most common cause of vacuous tests. When the schema distinguishes
states the profiled data never exhibits (a literal zero in a source that only has NULLs and
positives), fixture the missing state — nothing else forces it onto an expected cell.

**I4 — Multiplicity partitions.** Every aggregation gets a >1-member group and an exactly-1 group
(the 0 case is I3); every join gets a parent with ≥2 children. Expected values then differ from any
single row's, so copy-through bugs can't pass.

**I5 — Dirty-input pinning.** Per screenable defect the source can carry (orphan FK, out-of-domain
value, duplicate natural key, hierarchy violation, ordering violation): one fixture row exhibiting
it, an expected row pinning the transform's response (drop / pass-through / default), and — where
the defect is forbidden — the matching `empty` expectation. Which duplicate survives a dedupe is
invisible until a conflicting-duplicate fixture pins it.

**I6 — Mutation probes.** Run at plan-validation time, not on every run: corrupt one expected cell →
`cell-mismatches` must name that exact column; perturb one input cell → exactly the declared output
cells move. Both guard against vacuous tests: every `empty` expectation passes against an empty
output.

## Plan-level artifacts

**P1 — Coverage matrix.** Output columns (with the table's grain) × check classes; cells name the
covering expectation or expected-row cell, or state `gap: <reason>`; shared-attribute columns scanned
across transforms for agreement obligations (C1).

**P2 — Hand-derived expected rows.** From the fixture story and business meaning, arithmetic recorded
in the plan; never captured from output; every fixture row's fate appears in some expected cell.

**P3 — Live-bug handling.** A check failing against a deployed transform is a real finding: never
soften the test to green; quantify the damage at fixture and warehouse scale. Then fix now, or record
the red in the plan with the minimal fix body, per the session's terms. A stored test has no
red-by-design state, so a deferred fix must be visible in the plan or the test reads as broken.
