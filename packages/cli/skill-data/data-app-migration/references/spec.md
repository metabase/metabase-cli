# Specify: the rules behind every number

Phase 3. Turn `inventory.md` into `spec.md`: every rule a widget applies, tagged and cited, with each widget's verdict. Everything here comes from the source's code, its schema and Metabase's metadata: no query of yours reads the application's rows. This file is what the interview asks about and what the plan builds from, so write it for a reader who can query the data but not read the source code — never "see the code".

## Tags and citations

Every claim carries one tag:

- `PROVEN` — read directly from code, a schema or Metabase's metadata.
- `INFERRED` — reasoned from evidence that doesn't state it outright (a name, a comment, a pattern elsewhere), and every translation of code into SQL until a worked example from the source's own tests confirms it (_Translating code to SQL_).
- `UNKNOWN` — the code can't tell. It becomes a question in phase 4.

Every claim cites file:line at the source's commit `inventory.md` records, or the metadata that showed it. No claim stays untagged. Before the phase 4 checkpoint, check that each cited line still says what the claim says; a search of the line for the token the claim quotes will do.

## The rules, per widget

Go through each `W<n>` with this list. Each rule found is a line under the widget: the rule, its tag, its citation.

- **Status filters and exclusions:** which statuses count, which rows are left out (test or internal accounts, deleted rows, a flag), and whether the exclusion is applied here at all when a neighbouring widget applies it.
- **Joins:** the join type and its keys. An inner join to an optional parent drops rows silently (an order with no customer); a join to a child multiplies them (an order counted once per line item). Say which, and name the fixture row that shows it.
- **The date column:** which date places a row in a period (ordered, paid, shipped, refunded), and whether two parts of one number use different dates.
- **Clock and timezone:** where "now" and "this month" come from — the database's clock, the application server's, or the viewer's device — and in which timezone periods are cut. A partial current period shown as complete is a rule too.
- **Window bounds:** for each date preset and the default, its exact bounds — the start and end expressions, inclusive or exclusive, a date or a timestamp, which clock, which timezone. "Last 30 days" as `now() - interval '30 days'` is a timestamp window, not 30 whole days.
- **Money basis:** order totals or line items; shipping, tax and discounts in or out; refunds netted, excluded, or ignored; rounding.
- **Constants:** every hardcoded value the widget uses.
- **Scoping:** the condition that limits rows for a viewer, and whether it changes what a figure means (a customer's "first order" counted per shop rather than overall). Say what a viewer whose scoping value is null sees: a check that skips the filter on null shows that viewer everything, which the handoff reproduces with a group of unrestricted access (`mapping.md`, _Scoping_). Say which pages and widgets only some roles see.
- **Late facts:** a number counting something that happens after the event it is dated by (a refund, a cancellation, a repeat order) undercounts the newest windows until those facts arrive. Say so, with how long the code lets them take (a refund window), or that it doesn't say.
- **Static data:** a value the app shows as current but nothing updates (stock that sales never decrement) is stated as such.
- **Consequences:** a projection that treats a partial day as whole, a partial current period always shown below target — the effect a rule has on what the viewer reads, beside the rule.
- **The business's timezone:** where the business works (`app.timezone`, the locale, an address in the code or seed) against the timezone the code cuts periods in. A mismatch is a finding.

Late facts, static data, consequences and the business's timezone are notes beside the rules: parity pins the rules they follow from, not them.

## What the data holds, without reading it

Phase 2 found the database and checked every cited table and column. Learn the rest from the schema and Metabase's metadata:

- **Values a rule compares against:** the enum, check constraint or migration that declares a status, and every value the code compares with it. For a field Metabase marks as a category (a status, a type), its cached distinct values (`mb field values <field-id>`), never for one holding personal data. A value the data holds that the code never handles, or one the code compares against that the data lacks, is a finding.
- **Nullability and keys:** the schema's `NOT NULL`, foreign keys and defaults. A key the code treats as required but the schema lets be null is a finding, and a fixture case.
- **Types:** each column's type and time zone from `mb table get <table-id> --include fields`, and its database type and nullability from `mb field get <field-id> --fields id,name,database_type,database_is_nullable`.

Row counts, amounts and null rates need a query over the application's rows: leave them out.

## Translating code to SQL

When a rule lives in an ORM chain or in application code, the transform's SQL is its translation, written once, citing every line it translates. Follow each call to its definition — a scope, a helper, a base class, a trait — and write what it adds. Then check the chain against what an ORM does without saying so:

- **Hidden filters:** global scopes, soft deletes (Eloquent's `SoftDeletes` adds `deleted_at IS NULL`), Rails `default_scope`, a Django model's custom manager, Hibernate filters, a base repository class.
- **Relations:** an existence check (`whereHas`, `whereDoesntHave`, `exists?`) is `EXISTS` / `NOT EXISTS` and keeps rows whose key is null, where a join drops them; a filter across a relation (Django's `filter(customer__email=…)`) is an inner join; an aggregate across a to-many relation multiplies rows; Django's `annotate` before or after `filter` changes the result.
- **Work after the query:** casts and accessors (money in cents, a date converted to the application's zone), rounding that feeds further arithmetic or a comparison, reproduced with the source language's own rounding and unit-tested at halves and near-halves (PHP's `round` rounds halves away from zero after rounding to 15 significant digits; JavaScript's `toFixed` does neither), while rounding only for printing is display, and collection methods after the rows arrive (`->filter`, `->sum`, `reduce`, `.map`), which handle null, rounding and floating point as the language does, not as SQL does.
- **Bound values:** the clock's precision and zone (`now()` to the second or the microsecond, in the application's zone or UTC), what a date parameter becomes when bound to a timestamp column, and an aggregate over no rows (`null` or `0`).
- **Order and limits:** the sort and its tiebreaker; a top N without a tiebreaker orders its ties as the engine pleases, and the translation keeps the same sort.

A translation stays `INFERRED`, and you never build or run the source to check it. Its proof is the transform's fixture test (`parity.md`): expected rows worked out from the code, not from the SQL. It becomes `PROVEN` when a worked example in the source's own tests or fixtures, run as the fixture with the same inputs, comes out the same.

## Concepts

Many widgets show versions of one number: revenue, orders, customers. Group them, numbering each concept `C<n>`:

| Concept | Widget | Variant (the rules that differ) | Citation | Fixture rows that tell the variants apart |
| ------- | ------ | ------------------------------- | -------- | ----------------------------------------- |

Each widget keeps its own variant, and each variant becomes its own named Library number (`mapping.md`). A difference that comes only from a filter one widget takes and another doesn't is still two variants, and, with no reason in the code for it, a finding.

## Findings

What looks wrong in the source: two widgets that disagree with no reason in the code, a rule its own comment or name contradicts (test orders a comment says to keep out of reporting), a join that drops rows as a side effect, a caption that misdescribes its number, a status compared that no row has. One line each: the widgets, the citation, and the fixture rows that show it. A finding is built as the source does it, so the app shows the same figure. The phase 4 checkpoint and the handoff list the findings; fixing one is the user's request to make, and it becomes a decision.

## Hardcoded values

One list, `value | meaning | where`: targets, thresholds, cutoffs, allowlists, rates, defaults for missing values. Identifiers exactly as written.

## Verdicts

Open `spec.md` with the verdict matrix, one row per widget, then one per filter that changes figures differently from the source's. A widget's verdict is about its figures; a difference in a filter is that filter's row, naming the widgets it reaches, so it counts once:

| Widget | Verdict | Concept | Deviation or what is missing | Decisions |
| ------ | ------- | ------- | ---------------------------- | --------- |

- `EXACT` — reproducible from the data as the source defines it.
- `APPROX` — buildable with a stated deviation in a value it shows: a filter Metabase can't apply the same way, a proxy column, a value the brief requires that the platform can't produce (`mapping.md`, _The app's brief_). It cites the attempt that failed: the exact construct you built and what it got wrong, or a limit the data-app skills list as the platform's (`SKILL.md`, _Rules for every phase_). Before the plan checkpoint that is an MBQL body with its `mb query --dry-run` output; from phase 6 on, also a transform fixture test, or the app's type error or failing unit test, and the widget goes to the user then (`checkpoints.md`, _After phase 5_). A widget with no failed attempt is `EXACT`.
- `NONE` — not buildable from the data Metabase reaches. Say what is missing and what would unblock it: a table, a column, a database connection, a decision.

A list takes a widget's verdict, and an action its own (`records.md`).

Under the matrix, one line of counts per verdict, recounted from the matrix whenever a row changes.

## `decisions.md`

One row per decision, numbered in the order raised:

| Decision | Question | Default and why | Answer | Answered by | Widgets |
| -------- | -------- | --------------- | ------ | ----------- | ------- |

The default is the source's behaviour wherever the source has one. A row is written when the question is raised, from phase 2 on, with its answer empty until the user gives one. The plan, the build and parity cite `D<n>`; an empty answer blocks the widgets in its _Widgets_ column.
