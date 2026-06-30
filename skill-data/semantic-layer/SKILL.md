---
name: semantic-layer
description: Turn clean, analysis-ready tables into a shared vocabulary the org reuses - Metabase segments (saved filters, e.g. active customers), measures (saved calculations, e.g. net revenue), and metrics (official numbers, e.g. monthly recurring revenue) - so people stop reinventing the same definition five ways. Find the questions people keep asking, propose definitions in plain language, graft them onto what the org already tracks, build them via `mb segment` / `mb measure` / `mb card` create. For a non-technical user who knows their domain. Load when someone wants to "make this reusable", "define X officially", "standardize how we calculate Y", or "create a segment / measure / metric". Strategy skill for designing reusable definitions; for raw `mb segment` / `mb measure` mechanics, use `core`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Semantic Layer

> **Shared contract (read first).** This skill is part of the `robot-data-engineer` family and follows its shared rules: audience is a non-technical user, so no database jargon (skip "normalize"/"grain"; ERD/foreign key are fine; explain "wide"/"long" the first time you use them). Ask before showing PII row-by-row (names, emails, phones) — default to aggregates. When asked for something the CLI can't do (alerts, dashboard filters), name the limit instead of erroring into raw SQL. Honor the autonomy mode the user picked. Full text and the autonomy slider live in the router — run `mb skills get robot-data-engineer` and read its **Shared Contract** if you haven't.

Your job: take the clean, analysis-ready tables that already exist and turn the **questions people keep asking** into **shared, reusable definitions** — so "active customer", "net revenue", and "monthly recurring revenue" mean one thing across the whole organization, not five slightly-different things in five people's saved questions.

You build three kinds of reusable thing. These are real Metabase features with real names — **use the Metabase names** (segment, measure, metric) and teach them to the user as you go. They're product vocabulary, not jargon. Pair the name with a plain gloss the first time, then use it freely:

- **Segment** — a saved filter on a table. A reusable row-selector: "Active customers", "orders over $100", "EU shipments". People pick it from the **Filter** block in the query builder instead of re-typing the conditions. (Docs: <https://www.metabase.com/docs/latest/data-studio/segments>.)
- **Measure** — a saved aggregation on a table. A reusable calculation: "Net Promoter Score", "average order value". People pick it from the **Summarize** block instead of re-writing the formula. Only works on questions built directly on the measure's table. (Docs: <https://www.metabase.com/docs/latest/data-studio/measures>.)
- **Metric** — a reusable aggregation that lives in a **collection** (a folder), not bolted to a table. "Monthly recurring revenue", "weekly active users". It's the org's official definition of an important number, can be saved into the **Library**, and can carry a default time dimension for charting. (Docs: <https://www.metabase.com/docs/latest/data-modeling/metrics>.)

Introduce each like: _"I'll save this as a **segment** — that's Metabase's word for a reusable filter, so you can pull up active customers with one click anytime."_ After that, just say "segment".

This skill runs **after** the analysis-ready tables exist (build those with transforms — load `mb skills get transform`). Segments and measures only reach one table — no joins, no nesting (see the docs' Limitations sections) — so a semantic layer on raw, normalized tables is nearly useless: a real answer rarely lives in a single raw table. **Wide clean tables first, segments/measures/metrics second.**

You drive everything through the `mb` CLI. Load the CLI skills you'll need:

```bash
mb skills get core         # auth, profiles, db/table/field inspection, query, search
mb skills get mbql         # the definition bodies (filters and aggregations) are MBQL 5
```

Authentication is the user's job. Check `mb auth list --json`; if one profile exists, use it; if several, ask which; if none, ask them to log in. Pass `--profile <name>` to every command.

---

## Who you're talking to

A **non-technical user who knows their domain well.** They know the business — who an "active" customer is, what counts as "revenue" — but not databases. So:

- **Teach the words a curious non-engineer can follow; skip the deep-internals jargon.** Two sets are fine and worth teaching: Metabase product terms (**segment, measure, metric, collection, Library, the Filter / Summarize blocks**) and common data words a domain user can reasonably learn (**table, column, foreign key, schema, join, filter, row**) — gloss them once, then use them. Avoid **deep-internals jargon** that buys nothing for this user: grain, cardinality, normalize/denormalize, surrogate key, MBQL, `table_id`, materialize. Prefer the plain effect when it's clearer ("this number needs data from two tables" reads easier than "this needs a join across two fact tables") — but you don't have to contort around "foreign key" or "schema".
- **Talk about the question, then name the object.** Lead with what it does for them, then attach the term: _"I'll save 'big orders' as a segment so you can pull them up with one click."_ Not a bare "I'll create a segment on `table_id` 235."
- **Be a helpful colleague, not an engineer reporting status.** Elide the wiring (ids, query bodies, the CLI). Ask the one question that actually matters.

---

## Autonomy — honor the mode the user set

The user already picked an autonomy mode (the router's Shared Contract asks the slider once, up front — don't re-ask). Apply it to building definitions:

| Mode                    | What you do                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Check on everything** | Confirm every single definition (name + plain description) before building it.                              |
| **Balanced** (default)  | Build the obvious ones; ask only on the judgment calls (the prudential list below) and anything ambiguous.  |
| **Just go**             | Build the whole set, surface judgment calls as "here's what I picked and why — say the word to change any." |

**Two things never bend, in any mode:**

1. **When you're genuinely unsure — ask. Never assume.** "Just go" means _decide the obvious_, not _guess on the unclear_. A wrong-but-confident definition of "active customer" is worse than a one-line question.
2. **The final gate is a hard stop (see Phase 3).** No mode auto-publishes. You always stop, recap in plain language, and hand the user something to eyeball before anything goes live.

---

## Two kinds of decisions

**Hard rules — absolutes, never ask:**

1. **Never invent what a word means — pin it to real data.** "Active customer" is not yours to define. Before you build a segment for it, find out (from the user, or from how the data actually behaves) what _they_ mean: ordered in the last 90 days? Has a live subscription? Logged in this month? Confirm against actual values, then build to that. A definition built on a guessed meaning is a silent lie everyone then trusts.
2. **Keep the language at the level set in "Who you're talking to."** Metabase terms and common data words (table, column, foreign key, schema, join) are fine and worth teaching; deep-internals jargon (grain, cardinality, surrogate key, `table_id`) is not.
3. **Don't bury filters inside measures.** A measure should aggregate _what it's given_; let the user combine it with a segment at question time, rather than welding a filter into the measure. Welded-in filters collide and confuse when someone applies their own filter on top — and the metrics doc explicitly recommends against it. (Use conditional forms like `SumIf`/`CountIf` for "sum only the paid ones" — that's part of the measure's formula, not a hidden row filter.)
4. **Respect where each thing can reach.** Segments and measures work **only** on a question built _directly_ on their own table — not through a join, not on a question-built-on-a-question (the Limitations sections of both docs say so). If the definition needs more than one table's worth of data, you do **not** force a join into it. You go back and make the analysis-ready table wider first (a transform), then define on that. Quietly building a segment/measure that silently won't show up where the user expects is a hard-rule violation.
5. **Don't strand a metric on a single data source.** A metric is data-source-bound the same way — defined on table X, it appears only on questions built on table X, not on anything derived from it. If you need it to span sources, the answer is again a wider table first (a transform), not a join in the definition.
6. **Every definition keeps a clear, plain name and a one-line description in the user's words.** The name is what they'll see in a menu six weeks from now with no memory of this conversation. "Active customers (ordered in last 90 days)" beats "active_seg_v2".

**Prudential calls — genuinely contextual, state your lean, let the user decide** (skip the ask in "Just go" mode — pick your lean, flag it):

- **Which kind of thing is it?** Same wish, three possible homes:
  - "Let me filter to just the active ones" → a **segment** (saved filter).
  - "Let me add up revenue the same way everywhere, on this table" → a **measure** on the table.
  - "Revenue is an _official company number_ people pull onto dashboards" → a **metric** in a collection, with a default month-by-month view so it charts cleanly. Lean: make it a metric when it's a headline figure the org reuses across many questions/dashboards; keep it a measure when it's a table-local convenience.
- **Where the metric lives.** Metrics sit in a collection (folder). Lean: put the org's blessed ones in the shared **Library** so they surface prominently; keep experimental ones in a working collection until trusted.
- **Publish the official tables to the Library.** The clean, analysis-ready tables your definitions sit on are the org's official starting points — the **Library** is how you mark them as such. Tables published to the Library's **Data** section appear _first_ when anyone picks a data source, nudging people toward your curated tables instead of raw warehouse ones. Lean: publish the wide clean tables you built the semantic layer on; hold back raw or half-built ones. Setting up the Library is a one-time, harmless step (`mb library create` is idempotent). Surface which tables you'd publish and confirm. (Library is a Pro/Enterprise feature; only admins and data analysts can publish.)
- **Default time dimension for a metric.** A monthly default makes it chart nicely on a dashboard, but doesn't lock anyone out of other groupings. Lean: set a sensible default (usually month) for anything headline; leave it off for raw counts that aren't inherently time-series.
- **How strict a segment is.** "Active" = last 30 vs 90 days is a real business call with no right answer from the data alone. Lean: surface the few reasonable thresholds with how many rows each catches, let the user pick.

Phrase a prudential call as a lean plus a nod:

> "I'd save 'revenue' as a metric — Metabase's term for an official, reusable number — rather than a table-only measure, since people pull it onto dashboards a lot. Good?"

---

## The process

### Phase 0 — Understand what's reusable (quietly)

Don't narrate. One "Let me see what's here and how people are already slicing it" is plenty. Keep it cheap — compact column listings, `LIMIT`/`GROUP BY` samples, never whole-warehouse rollups.

1. **Confirm the analysis-ready tables exist.** List tables; find the wide, clean ones (a transform step's output). If the user is pointing you at raw normalized tables, say so plainly and suggest building the clean table first — don't build a hobbled semantic layer on raw data.
2. **Find the questions people keep asking.** Search existing saved questions and dashboards (`mb search`, `mb card list`) for repeated filters and repeated calculations — the same "status = active" written eleven times, five hand-rolled versions of revenue. Those repeats _are_ the semantic layer waiting to be named. This is the highest-signal input; mine it before proposing anything.
3. **Learn the real meanings.** For every candidate segment ("active", "churned", "high-value"), find what the words map to in actual values — distinct values of a status column, the spread of an amount column. Never define on a guessed meaning (hard rule 1).
4. **Graft onto what the org already tracks.** This is the part a model does worst and a human does best, so lean on the user: a new definition is far more useful when it lines up with the entities and language the organization _already_ uses. Before inventing "customer health score", ask whether there's already a notion of an active/at-risk customer in their world, and match it. Isolated definitions that don't connect to the existing model are low-value. Ask; don't infer the connection from column names.
5. **Check reach before promising.** For each candidate, confirm it can actually live where it needs to: a single-table segment/measure must sit on the table people will build questions on; a multi-table answer needs a wider table first (hard rules 4–5). Catch this now, not after building something that won't appear.

### Phase 1 — Propose the shared vocabulary (plain language)

Show, in plain terms, the definitions worth saving — lead with what each _does for the user_, and name the Metabase feature so they learn it:

**Segments — saved filters** (so people pull up the same set with one click):

> • **Active customers** — ordered in the last 90 days. ~2,400 of your 6,000 customers.
> • **Big orders** — over $100. About 1 in 5 orders.

**Measures — saved calculations** (so everyone adds it up the same way):

> • **Net revenue** — total paid, minus refunds.
> • **Average order value** — net revenue per order.

**Metrics — official numbers** (the headline figures, for dashboards):

> • **Monthly recurring revenue** — I'd save this as a metric with a month-by-month default, since it's a dashboard headline. Good?

Then surface what you're _not_ saving and why ("I left 'orders this week' alone — it's a one-off, not something you'd reuse"). Ask your prudential questions — one at a time, lean-plus-nod. In "Check on everything" mode, confirm each definition here before Phase 3. In "Balanced", ask only the judgment calls. In "Just go", state your picks and move on.

### Phase 2 — Iterate (cheap, nothing built yet)

Adjust names, meanings, thresholds, and which-kind-of-thing until the user is happy. Re-confirm the final list in one short recap. If a definition turns out to need more than one table, say so plainly and point back to making the table wider — don't smuggle in a join.

### Phase 3 — Build, verify quietly, then hard-stop

Build each agreed definition. Mechanics (load `mbql` for the definition bodies):

- **Segment** → `mb segment create`. Body: `name`, `table_id`, and a `definition` (a flat MBQL filter clause). Update later with `mb segment update <id>` — needs a `revision_message` (the audit note: _why_ it changed). Never delete-and-recreate.
- **Measure** → `mb measure create`. Body: `name`, `table_id`, and a `definition` holding **exactly one** aggregation. Same `revision_message` rule on update.
- **Metric** → `mb card create` with the metric shape (`type: "metric"`) — it lives in a **collection**, carries a `dataset_query` (the aggregation) and an optional default time dimension. Put org-blessed ones in the Library collection.
- **Publish the official tables** → `mb library create` (idempotent — provisions the Library if it isn't set up yet), then `mb library publish --table-ids <ids>` to move the clean tables your definitions sit on into the Library's **Data** section. It resolves the Data collection itself, so there's no collection id to hunt for. Published tables surface first in every data picker, so people start from your curated set, not raw warehouse tables. (Run `mb skills get core` for the `library` group; it needs `library` premium + admin/data-analyst.)

Then **verify what the user can't see**, before you hand back:

- Each segment actually narrows the rows you expect (`mb query` / preview the count — does "active customers" really return ~2,400?).
- Each measure and metric returns a sane number, not null or an error.
- Each definition shows up **where the user will look for it** — on a question built on the right table. A segment that silently won't appear (built on the wrong table, or one that would need a join) is the classic silent failure; catch it here.

Then **stop. Hard gate — every mode, no exceptions.** Recap in plain language and hand the user something to open and eyeball:

> Done. Here's the shared set you can now reuse:
>
> **Segments** (saved filters — in the **Filter** block on the Customers and Orders tables):
> • **Active customers** — ordered in the last 90 days
> • **Big orders** — over $100
>
> **Measures** (saved calculations — in the **Summarize** block):
> • **Net revenue** • **Average order value**
>
> **Metric** (in your **Library**, charts by month):
> • **Monthly recurring revenue**
>
> **Published to the Library** (these now show up first when anyone picks a data source):
> • **Customers**, **Orders**
>
> Open any of those tables' Filter or Summarize block in Metabase to see them in place and try one — give it a look before you start building dashboards on top.

End on that plain-language map. It's what the user reads to trust the result — and it's what stops a wrong definition from quietly propagating into everything built next.

---

## A worked example (for your reference, not the user's)

User: _"Everyone calculates 'active users' differently — can you make it official?"_

- **Don't** create a segment from the phrase alone. **Find the real meaning first:** search existing questions — three people filter on "last seen in the last 30 days", two on "subscription status = active". That's the ambiguity to resolve. Ask: "I see two takes on 'active' — seen in the last 30 days, or has a live subscription. Which do you mean?" (hard rule 1).
- They say "live subscription, and seen in the last 30 days." **Check reach:** both pieces of info must live on the one table people build questions on. If subscription status and last-seen sit on two different tables, a single segment can't span them (hard rule 4) — to the user: "those two facts live in different places right now, so I'll widen your Customers table to carry both first, then save the filter on it." Build the transform, then the segment on the wide table.
- Build it as a segment on the wide table. **Verify** the row count is plausible. **Recap** plainly and stop: "Saved **Active users** — live subscription and seen in the last 30 days — as a segment on your Customers table; it's in the Filter block there. Have a look before you build on it."

The shape recurs: a word people use loosely → pin it to real values → check it can live where they'll use it → build → verify → hard-stop with a plain recap.
