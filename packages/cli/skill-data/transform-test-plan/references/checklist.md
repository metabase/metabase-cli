# Confirmation checklist

The judgment calls a plan depends on, in derivation order. Each question
carries a **detect** hint — how to answer it from the SQL, the metadata, or
profiling. Answer autonomously where the hint resolves cleanly; ask where it
doesn't. Every answer you supply yourself goes into the emitted plan as a
stated assumption, phrased so the owner can falsify it at a glance
("Assuming `discount` can never be negative — correct?").

In build-along mode these are design questions: the owner is deciding, not
recalling. An undecided answer is a decision to make together — surface the
options and the check each implies (the checks.md entry named in parentheses).

## Stage 1 — classify the model (per transform)

1. **Grain: one row per what?** (G1, G2)
   Detect: `GROUP BY` keys; otherwise the driving table of the joins. Confirm
   whenever detection and any written description disagree — that disagreement
   is itself a finding.
2. **Full rebuild or incremental?** (F1)
   Detect: a plain `SELECT` materialization is a full rebuild; merge/append/
   watermark logic means incremental. Incremental switches on a whole extra
   fixture battery — never assume it silently.
3. **Fact-table type — and if periodic snapshot, dense or sparse?** (F2)
   Detect: event-grain with a single event date → transaction; entity×period
   grain → periodic snapshot (density is the one yes/no that flips its whole
   invariant set — always confirm); one row per pipeline occurrence with
   milestone-date columns → accumulating snapshot.

## Stage 2 — per-table declarations

4. **Conservation ties: output rows/sums tie to which input, with which
   declared exclusions?** (A2)
   Detect: `WHERE` clauses and join types name the exclusions (filtered rows,
   dropped duplicates). Exclusions must be declared, or conservation appears
   to fail.
5. **Zero-group policy: does a group with no contributing rows appear (with
   zeros) or stay absent?** (A5)
   Detect: driving table of the rollup — grouping the detail can't produce
   empty groups; joining a dimension first can.
6. **Orphan handling per join: drop / keep-with-NULLs / default row — and is
   an orphan tolerated (warn) or forbidden (error)?** (C3, I5)
   Detect: join type. INNER = drop, LEFT = keep-with-NULLs, COALESCE to a
   sentinel = default row. Tolerated-vs-forbidden is the owner's call —
   profiling says whether orphans exist today, not whether they're acceptable.
7. **Version history: effective/end/current columns anywhere? If not, confirm
   overwrite-everywhere.** (T1)
   Detect: column names. Absence means history is silently rewritten in
   rollups — state that consequence when confirming, not just the mechanism.
8. **Which consuming cards warrant end-to-end suites?** (P4)
   Detect: can't — which cards matter is the owner's call. Default to the
   cards the chain was built to serve.

## Stage 3 — per-column declarations

9. **Each measure: additive, semi-additive, or non-additive?** (A1)
   Detect: sums and counts are additive; balances and levels are
   semi-additive; ratios, rates, and unit prices are non-additive. Confirm
   the ambiguous ones (a "score"? a "quantity on hand"?).
10. **Legal bounds per measure?** (Q1)
    Detect: profiling min/max suggests, business meaning decides — can
    `discount` be negative? can `quantity` be zero? Derived bounds are free
    (a sum of non-negatives is non-negative).
11. **Each derived measure: the exact recomputation rule?** (A3)
    Detect: the SELECT expression is the rule — but rounding, business-day
    adjustments, and NULL handling are conventions to confirm, not read.
12. **Which columns are stored aggregates, over which detail and filter?** (A4)
    Detect: correlated subqueries / joined-aggregate CTEs in the SQL.
13. **Which categorical columns have closed domains — enumerate; is NULL a
    member?** (C2)
    Detect: profiling distinct values / `mb field values` gives today's set;
    the owner confirms it's closed rather than merely small so far.
14. **Which columns are denormalized copies, of which owning attribute?** (C1)
    Detect: `<entity>_<attr>` naming; any column functionally dependent on a
    non-grain key. Every hit must be classified: copy (C1), stored aggregate
    (A4), or smuggled coarser-grain fact (a finding).
15. **Which many-to-one edges hold within one output table?** (C4)
    Detect: hierarchy-shaped column pairs (product/category, zip/state).
    Applies where no owning table is in scope; otherwise C1 covers it.
16. **Which date orderings are business-guaranteed vs. known-violated and
    tolerated (with real-data counts)?** (T2)
    Detect: profiling counts the violations that exist; the owner decides
    tolerated vs. bug.
17. **Null policy per column — measures, attributes, FKs separately.** (Q2)
    Detect: the SQL shows what's produced (COALESCE, CASE); the owner
    confirms intent — "count of nothing": 0 or NULL? empty date: NULL or
    sentinel?
18. **Which columns are volatile across runs?** (T3)
    Detect: `now()` / `current_date` / run-metadata expressions in the SQL.
19. **Per tolerated oddity: warn or error — and is anything currently
    tolerated that should become forbidden?** (Q3)
    Detect: can't — this is the conscious-choice question the warn convention
    exists to keep alive.
