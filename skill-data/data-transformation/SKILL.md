---
name: data-transformation
description: Turn a raw, normalized source database into a small set of clean, analysis-ready tables. Claude investigates the source, works out the real-world "things" the data is about (even when each one is scattered across several tables), decodes coded/JSON/translated values into readable text, and builds one wide, denormalized table per thing as Metabase transforms. Designed for a non-technical user who knows their domain. Use whenever someone wants to "clean up", "flatten", "denormalize", "make sense of", or "build analysis-ready tables from" a raw database.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Data Transformation

Your job: take a raw source database — usually normalized, often Fivetran-synced from some SaaS tool — and produce a **small set of wide, clean, analysis-ready tables**, one per real-world _thing_ the data is about, built as Metabase **transforms** the user can inspect.

Drive everything through the `mb` CLI. First load the skills you'll need:

```bash
mb skills get core         # auth, profiles, db/table/field inspection, query
mb skills get mbql         # if you build transform queries in MBQL
mb skills get transform    # creating/running transforms, run inspection
```

Authentication is the user's job. Check `mb auth list --json`; use the one profile if there's one, ask which if there are several, ask them to log in if there are none. Pass `--profile <name>` to every command. That profile's `url` is the instance's base URL — build every browser link below from it, so what you open always matches the instance the CLI is hitting.

---

## Who you're talking to

A **non-technical user who knows their domain well** — they understand the business (events, customers, invoices, whatever it is) but not databases. So:

- **No modeling jargon.** Skip the warehouse vocabulary they won't know — grain, fact/dimension table, normalize, join, surrogate key, entity, materialize — and prefer plain phrasing: "one row per \_\_\_", "what it tells you", "links up with", "how full a column is", "the kinds of things in here". **But don't overdo it:** they work with tables, so basic relational terms are fine — table, column, schema, key, foreign key (cardinality too, though "one-to-many" usually lands better). And **Metabase's product terms are encouraged** — Question, Model, Segment, Measure, Metric, Transform — they're the user's tools, not database jargon.
- Group what you show by **the question a column answers**, never by which source table it came from.
- Be a **helpful assistant, not an engineer reporting status.** Elide the machinery; ask the one sharp question that matters.

---

## Two kinds of decisions

Sort every choice into one of these.

**Hard rules — absolutes, never ask:**

1. Never flatten a multi-valued field into one opaque blob (e.g. three options jammed into `"email | phone | text"`). It destroys filterability, which is the whole point.
2. Never use jargon with the user.
3. Always surface **real data you're about to leave out** — proactively, ranked by how much is actually there.
4. Never guess what a column or code means from its name. Confirm against the actual values.
5. Never silently drop a whole _thing_. Dropping a column is routine; dropping a whole kind-of-thing (e.g. "suppliers") must be surfaced and confirmed.
6. Never drop the columns that link things together. Every table keeps its own id **and** the ids tying it to your other tables — alongside the readable labels you copy in, not instead of them. The label is for reading; the id is what lets two tables be combined later. You're building several tables about _related_ things, so they **will** be combined ("sales per region", "messages per customer") — a dropped id makes that quietly impossible, and the user can't see it happened. (Same bargain as rule 1: that one preserves _filtering_, this preserves _combining_. Keep the ids; just don't make the user stare at them.)
7. Never bake a non-obvious business rule into a table without confirming it in plain terms. When a transform encodes a judgment the user would have an opinion on — how money nets (a refund is money back _out_), which row is someone's "current" one, what "active" means — say it back in one plain sentence and get a yes first. You know the columns; only they know the business, and a wrong rule hides perfectly inside a clean-looking table. ("I'm treating each person's most recent sign-up as their current one — right?")
8. Never quietly carry sensitive personal data through. Flag it when you find it — addresses, phone numbers, emails, IPs, payment/financial fields — and let the user decide how to handle it (the prudential call below). Default to surfacing it, never to silently exposing it in a table others will browse.

**Prudential calls — contextual, multiple good answers, hinge on domain knowledge you lack. State a lean, then let the user decide.** The recurring ones:

- **Multi-valued attribute** (one response → many options; one order → many line items): keep it filterable — a small companion table or a structured column, never opaque text. Structure is the user's call. Lean: whatever keeps filtering simplest.
- **Layering**: default **flat** — one self-contained table per thing, no behind-the-scenes intermediate tables. Suggest a shared cleaned-up base table only if the same cleaning would otherwise be copied across many tables — and even then, ask.
- **Out-of-scope things**: surface every kind-of-thing you find and ask in/out, rather than inferring scope from what they happened to mention.
- **A repeating thing vs. the events it takes part in**: one table can mix a _stable_ thing (a customer, a company) with the _repeating_ events it's in (each order, each visit), copying the stable details onto every event row. If that thing genuinely recurs — same customer on many rows — consider giving it its own one-row-per-thing table too, linked by id, so "how many distinct customers" and the per-customer details have a clean home. Lean: split when recurrence is real, keep as one table when each appears once. (Phase 0's one-to-one / one-to-many check already tells you which.)
- **Handling sensitive data** (addresses, emails, phones, IPs, financial details): once you've flagged it (rule 8), _how_ to carry it is the user's call — keep as-is, mask (last-4, domain-only, city not street), or drop. Lean: keep what the stated work needs, mask the rest, drop what nothing needs.

Phrase a prudential call as a lean plus a nod:

> "I'd keep these as one simple table rather than splitting into behind-the-scenes pieces — easier to look through. Good?"

---

## The process

### Phase 0 — Investigate (quietly)

Don't narrate this — a single "Let me take a look at what's in here — one minute" is enough. Keep it cheap: never pull whole-warehouse rollups (they blow up); use compact column listings, `LIMIT`/sample queries, and `GROUP BY count(*)`.

**Get oriented first.** As soon as you know which database and schema you're in:

- **Show the user the map.** Open the instance's schema map for that schema so they can follow along: `<base-url>/data-studio/schema-viewer?database-id=<db-id>&schema=<schema>`. Open it in their browser if you can (e.g. the `open` / `xdg-open` command); if you can't, just paste the URL.
- **Ask for a head start.** "Do you have a picture or file showing how your data fits together?" If yes, read it — it shortcuts the next steps.
- **Ask for their conventions.** "Is there already cleaned-up data, or a past project, that shows how your team likes this done?" If yes, inspect it: it tells you their naming, their idea of "clean," and existing tables worth linking to.

Then dig in:

1. **Map the tables.** List them; pull each one's column names and types; note its own id.
2. **Find the decode tables.** Normalized SaaS data hides meaning in lookups — `*_field`, `*_field_choice`, `*_question`, `*_choice`, `*_type`. A column like `c_4471` is meaningless until you join the lookup and find it's _"Preferred contact method"_. Build that code → label map yourself by joining the lookups — never hand the user a coded column and ask what it means — before showing them anything.
3. **Prove the connections — don't trust declared keys.** Synced databases usually have none. For each `<x>_id`, guess it points at `<x>`, then check what fraction of values actually match the target's id: high = real link, low = decoy, discard. Note one-to-one vs one-to-many. **Also look outward** — does a thing you're about to build already exist as clean data elsewhere in the instance (an existing customers table your people match, a product list)? If so, plan to _link_ to it, not duplicate it.
4. **Pin down "one row per what."** Count rows; check the id is unique; figure out what a single row is. **Watch for lies:** a stale count column, or a table that looks like "all of X" but is a filtered subset.
5. **Reconcile across related tables.** Do child rows all link to a parent? Orphans? Is one table a trimmed snapshot while another keeps everything? These mismatches matter and the user can't see them — you must.
6. **Profile the values.** List distinct values for coded/low-variety columns; check how full (% non-empty) any column you might drop is; spot multi-valued JSON fields.
7. **Cluster into things.** Group tables and columns into the real-world things they describe — a thing may span several tables (one _customer_ across a main table + a loyalty table + custom-profile columns). Decide "one row per \_\_\_" for each and gather its attributes, decoded. Watch for a table that secretly mixes _two_ things — a stable thing plus its repeating events; that's the split in the prudential calls above.

**Then, still quietly, sketch the design space.** Once the things and how they connect are pinned, brainstorm the range of questions this data could answer — finance views, leaderboards, breakdowns by any attribute. **This is not goal-setting and you don't show it to the user or build any of it.** Its only purpose is to pressure-test your table design: would a reasonable pivot to a nearby question force a rewrite? When keeping a column or a finer grain _cheaply_ preserves that flexibility, keep it. The clean data must serve the user's stated concern — but a good engineer doesn't scope so tightly that the next question means starting over.

### Phase 1 — Present what you found (plain language)

Three things, in order:

**(a) The things, in plain terms.** One short blurb each. E.g. in an online store:

> **Customers** — one row per customer. Who they are (name, company, location), how they've been in touch, what they've spent, whether they're active or churned.

**(b) The full inventory — including what you'd leave out.** Never infer scope silently:

> I found 6 kinds of things: **Customers, Orders, Products, Suppliers, Shipments, Returns.** I'd build the first four. **Shipments** and **Returns** also have real data — want those in, or leave them?

**(c) What would be set aside — proactively, ranked, two buckets:**

> Nothing important is lost. A few things set aside:
> • **Real data** — gift-message text (6 of 10 orders), delivery instructions (most), preferred carrier. Minor, but real — want any kept?
> • **Safe to drop** — duplicate product names in other languages, internal bookkeeping columns. No real loss.

If you spotted existing clean data to link to (step 3), raise it here too — and **always run a suspected match past the user before wiring it; never graft onto their existing data silently.** Then ask your prudential questions, one at a time, each a lean-plus-nod.

### Phase 2 — Iterate

Cheap, because nothing's built. Adjust the set of things, what's kept, and the shape of any multi-valued pieces until the user's happy. Re-confirm the final picture in one short recap.

### Phase 3 — Build, check, hand back

Build one wide transform per agreed thing. Each table:

- **Denormalized, but the link stays.** Copy in related context so casual reading needs no lookups (a product's name and price on the orders table) — **and keep the linking id beside it** (the product's id too). The label is for reading; the id keeps the tables combinable. Use the same id name everywhere a thing appears.
- **Decoded**: codes and JSON become readable text; bookkeeping columns and soft-deleted rows are gone (filter the source's delete flag — e.g. `_fivetran_deleted` — so tombstones never reach clean data).
- **Clean, plain column names**, consistent across tables.
- **Multi-valued pieces** in the agreed filterable structure — never opaque text.
- **Keep the detail; don't pre-summarize it away.** Build the detailed rows (one per order, one per payment), not pre-computed totals. A convenience count is fine _beside_ the rows, never _instead of_ them — a frozen total only ever answers the one question it was summed for.

Then make the links real, not just implied:

- **Wire foreign keys between your tables.** Mark each linking id as a foreign key pointing at the id it references (`mb field update` — set the column's type to foreign-key and its target). Now Metabase itself knows the tables connect and can traverse them.
- **Graft onto existing clean data** the user approved (step 3 / Phase 1): point the linking id at the existing table's id the same way. Link, don't duplicate.
- **Write down what you learned.** You decoded every column's real meaning while investigating — save it: set a short description on each table and its non-obvious columns (`mb table update` / `mb field update`). The cleaned data then explains itself inside Metabase — in search, in the Question editor, to Metabot — instead of the knowledge living only in this chat.

When you start refining a built transform _with_ the user, open its inspector for them so you're looking at the same thing — `<base-url>/data-studio/transforms/<transform-id>/inspect` — opening it in their browser if you can, else pasting the URL. Iterate with `transform update`, never delete-and-recreate.

**Check the output before handing back — the user can't.** After each transform runs, look at the actual data and run quick ad-hoc tests against what Phase 0 led you to expect: row counts in the right ballpark, decoded columns actually readable (no stray codes), linking ids that resolve to the other tables, no column unexpectedly all-null or blown up in count. Treat surprises as bugs to chase, not noise. A table that can't combine with the others — usually a dropped id, or the same id named two different ways — is a silent failure; catch it here.

Then report plainly:

> Done. Three tables:
> • **Customers** — transform #41
> • **Orders** — transform #42
> • **Products** — transform #43
>
> How they connect: each **Order** belongs to a **Customer**; each **Order** lists one or more **Products**.

End on that connection map: it's what the user reads to trust the result, and what lets whatever they build next combine the tables correctly.

---

## A worked decode example (for your reference, not the user's)

The shape recurs across SaaS exports, whatever the domain. A coded column — say `c_4471` on a responses table — means nothing alone. A lookup (`*_question`, `*_field`, `*_choice`) has a row where `attribute = 'c_4471'` and `name = "Preferred contact method"`. Single-select answers are often already `{"id":…, "value":"Email"}` — use `value`. Multi-select answers are arrays like `[{"value":"Email"},{"value":"SMS"}]` — the multi-valued case: keep each value filterable, don't concatenate.

Always decode _before_ presenting, so the user sees "Preferred contact method", never `c_4471`. Three cautions:

- **Pull the readable name from the lookup, don't type it in.** The label (and any question text) should come _from_ the lookup's `name`, sourced in the query — not pasted as a literal. A hard-typed label goes wrong the moment the source changes.
- **Codes are usually specific to today's data.** `c_4471` exists only for _this_ form or instance, so one-column-per-code is tied to the data as it stands — a new form or instance won't line up. When that's unavoidable, say so on hand-back ("reflects the current form; new questions need a refresh"), and with many such codes prefer the companion-table shape (one row per answer, question text from the lookup): nothing hard-typed, and adding a question is a smaller change.
- **Normalize encodings once.** Turn raw representations clean in the table itself, so nothing downstream re-derives them: signed amounts → clear positive numbers by kind, 0/1 → true/false, timestamps → one consistent timezone, text → trimmed and case-consistent, and junk placeholders (`"NULL"`, `"N/A"`, `"-"`, empty string) → real null.
