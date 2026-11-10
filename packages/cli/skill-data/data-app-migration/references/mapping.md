# Plan: the data side and the app's brief

Phase 5. For every widget phase 4 kept, decide where its numbers come from in Metabase, and write what each app must show: its brief. The app reads only the Library (`data-app-data`, _Sources_), so this skill builds the data side up to the Library, and the data-app skills build the app from the brief. Every rule is the source's, as `spec.md` states it, findings included; cite the `D<n>` wherever a rule follows a decision: an accepted `APPROX`, or a change the user asked for.

## `plan.md`

Open with where the transforms write (_Transforms_), their tag, and the objects to create, each transform citing the SQL `spec.md` holds for it and adding only what the transform changes, in build order: transforms, tables to publish (each by id, or by the transform that makes it), metadata changes, segments, measures. Then one row per widget:

| Widget | Data path | Library objects | Filters | Shows |
| ------ | --------- | --------------- | ------- | ----- |

- **Library objects:** the published table, segment or measure that carries each number the widget shows, by name.
- **Filters:** the `F<n>` that reach the widget in the source.
- **Shows:** the values the widget displays (a figure, a series and its grain, a table's columns, order and length), from `inventory.md`.

Close with each app's brief (_The app's brief_).

## Data path

From the source construct to the Library. A widget often needs several of these.

- **An aggregate over one table with filters:** the table published; the filter as a segment; a measure only for a number several widgets share in whole periods (a day, a month). The plan names, with each number, its segment and the columns the viewer's filters reach. No metric: an official number the whole instance and Metabot see is a choice about the business, not the app, and the handoff leaves it to the user. Each widget's variant of a concept is its own named number.
- **A join along a foreign key:** the foreign key set in metadata (`metadata`), so a question reaches the parent's columns. Metabase's foreign-key join is a left join and keeps every row. An inner join in the source drops the rows whose key is null or points to no parent row: reproduce the null case with a segment that is `not-null` on the key, and the missing-parent case with a transform that keeps the inner join. The rows the source drops stay dropped, even when the drop looks accidental (a finding).
- **Any other join, a CTE, a window function, a multi-step computation:** a transform, reusing the source's SQL as it is, changed only where `decisions.md` records a change or where a transform needs another spelling of the same query (a column qualified by an alias instead of its table name, `transform`, _Transform tests_); its table published. Where widgets share a table but not a filter (one excludes test orders, another doesn't), the transform keeps every row the widgets need with the column the filter reads, and a segment carries the filter for the widgets that apply it.
- **A per-row derived value** (an amount net of refunds, a customer's first order date, a cohort month): a column computed in a transform.
- **A matrix built in code** (a cohort grid): a long table from a transform, one row per cell.
- **Math in application code over fetched rows:** a transform column where its inputs are known before the viewer picks anything. Otherwise the brief states the arithmetic over the values Metabase returns, citing the code.
- **A number that aggregates per entity inside the window the viewer picks** (customers with two or more orders in the period, the median spend per customer): a transform runs before the viewer picks, so it keeps one row per entity and event, with the date column, and the brief states the rule for a window, citing the code.
- **The clock inside the source's SQL** (`CURRENT_DATE`, `now()`): the source reads it on each page load, a transform only when it runs. Within the freshness the user accepted (phase 4), a transform may read it at its run: days expanded as rows up to its run date, the app cutting only at the viewer's "now". An expression whose value would move between runs by more than that freshness goes to the app, through the brief: a respelling of the same query, not a change.
- **Every figure from one question:** shape the data so each figure a widget shows is one question's result, not arithmetic in the app: a net amount as the sum of a signed column (an order's total, a refund's negative), a rate as the average of a 0/1 column where both its counts are the same rows on one date column, a figure set against a target as one table carrying both at the scoping grain (each month's revenue beside its target; a target shared across scopes is its own `cfg_` row, so it is never summed), a long table with a column naming each series (rental, damage, late fee) rather than one table per series, days as rows rather than days counted in app code. Arithmetic stays in the app only where no table can hold the figure: it depends on the window the viewer picks in a way no column carries.
- **A constant:** _Constants_.
- **A date window:** _Date windows_.
- **Rows limited by who is viewing:** _Scoping_.
- **An outside API:** a data app calls one only from the viewer's browser (`data-app-ui`, _External APIs_), so an API that needs a key, or refuses a browser's request, leaves the widget `NONE`. One the app calls is pinned by unit tests on mocked responses, written from the source's handling of them.

Whatever `data-app-data`'s _Sources_ won't let a question compute goes into a transform first.

## What gets published

Every table a question reaches must be published — its source, each table it reaches through a foreign key, and the tables behind its segments and measures (`data-app-data`) — and viewers need data access to each. Publishing follows display values, not foreign keys: it never publishes a table that a plain foreign key points at, nor the tables a transform reads, and always publishes, recursively, each table that a published table's fields take display values from. So `plan.md` lists every table to publish, and phase 6 publishes them by id (`mb library publish --table-ids …`) in two batches, the transforms' tables and then the raw tables, comparing the database's published tables with the plan after each batch and after the metadata step (`SKILL.md`, phase 6). A table published that the plan didn't name can't be unpublished on its own: unpublish the planned table at once, which takes the extra one with it, then ask whether to publish a transform of the planned table instead, whose fields carry no display values, or to accept it.

Publishing gives query-builder access to the table to every group that can read the Library. What such a group sees is limited only by its data access, so a group with unrestricted view data on the source database reads every row from phase 6 on. The plan checkpoint says so before its yes.

Publish a raw source table only when it holds no credential and no personal data beyond the columns a widget shows — a users table carries password hashes and session tokens. Otherwise a `stg_` or `dim_` transform selects the columns the widgets need, and that table is the one published, with the foreign keys pointed at it. So is a table with a foreign key to such a table: its fields can take their display values from it, and publishing it would publish that table too.

## Transforms

- Every transform writes into an output schema in its source database, separate from the schema the application's own tables live in. The default name is the app's slug with underscores and `_analytics` (`store_admin_analytics`), one that no schema in the database and no earlier run in the repository's history already uses; the plan checkpoint confirms it. Two source databases get one output schema each.
- A database without schemas (`schemas` missing from its features, `SKILL.md`, phase 2; MySQL is one) has nowhere separate to write: a transform's table lands in the database the connection opens, beside the application's tables. The interview raises it as a decision: tables there, under the slug's prefix before the layer's (`store_admin_fct_orders`), or no transforms, which leaves only the widgets that need none. Metabase also creates and drops its own `mb_transform_temp_table_*` tables there on each run.
- Prefix each transform's table by its layer — `stg_` (cleaned source), `int_` (a step), `fct_` (one row per event), `dim_` (one row per thing), `cfg_` (constants) — and file each transform in a collection of the transforms namespace (`transform`). This departs from `data-workflow`'s rule to match the source's own naming and agree names with the user (`building-clean-tables`): the prefix tells a reviewer which tables the app reads and which only feed others. The plan checkpoint shows each table with what it holds in the user's words (one row per order, with its net amount).
- Each transform gets its tag at the end of phase 6 (`SKILL.md`), so the tag's job never runs an untested transform. A transform's tags travel with it in the export; the job doesn't, so the handoff names the job to check on the target instance.
- Nothing is written to the source database before the plan checkpoint returns. The first transform test or run proves the write path; a transform test writes only temporary tables. A permission or missing-schema error from either is a stop for the database admin, named with the error, not a test failure to iterate on: never retry, switch schemas, or write elsewhere. A connection that can't write leaves only the widgets that need no transform: before any export, delete the transforms whose runs failed, say which widgets remain, and ask whether to go on with them, as a checkpoint of its own.
- A write that lands outside the output schema, or without the prefix where there is no schema, stops the migration before the next command. Metabase's own `mb_transform_temp_table_*` tables are not such a write.
- A SQL transform reads one database and can't join across databases. A widget that needs two is a phase 4 decision, with three options:
  1. replicate the table into one database (recommended)
  2. a Python transform, where a runner is configured
  3. a small hand-kept copy, recorded with how stale it may get

- Where transform tests are available, each transform is pinned by a fixture test before it runs on real tables (`parity.md`, _Transform fixture tests_).

## Date windows

The source's date filters keep their exact windows: rolling days, this year, a custom range.

- **The data side carries the definition.** The transform computes the column the number sums (an amount net of refunds, as the source nets it), a segment holds the definitional filter (not a test order, a counted status), and a measure the number, where one is made (_Data path_). The window is the viewer's pick, so the app applies it.
- **The zone a period is cut in** is the source's (`spec.md`, _Clock and timezone_). Where it isn't the instance's report timezone, a transform computes the date or timestamp in that zone for the questions to group and filter on: the report timezone applies to every question on the instance, so it changes only when the user asks.
- **The brief carries the window** as `spec.md` states it (_Window bounds_, _Clock and timezone_): each date filter's presets, default and bounds, the zone each window is cut in, and each comparison that switches a widget's behaviour. Each of the source's presets keeps its exact bounds, and a page opens on the source's default window. A data app's "now" is the viewer's device clock, the only one it has: the brief cuts every window from it in that zone. Where the source reads a server's or the database's clock, that is a note on the filter, not an `APPROX`.

## Scoping

A data app's viewers are Metabase users, and Metabase's permissions reproduce the source's access (a manager sees only their branch): the app's viewer groups decide who opens it, and row-level security on the scoping column, for a user attribute, decides whose rows each viewer sees. Both are the user's steps in the handoff (`handoff.md`, steps 6 and 7): the CLI can't configure users, groups or row-level security. So:

- Every transform keeps the scoping column (`shop_id`, `tenant_id`) at the grain row-level security needs.
- The brief gives the unscoped viewer's page, with a filter on the scoping column where the source offered one.
- A page or widget the source shows only to some roles goes into a data app of its own, with those roles' groups as its viewers: every viewer group of an app opens all of it. That app holds those roles' view of the pages; `plan.md` gives each app its slug and brief, and all of them go on one branch. A control only some roles see (an owner's shop selector) doesn't split the app: which rows a viewer's figures cover is row-level security's, and whether the control shows is the data-app skills'. The table such a control reads is then a scoped table too. A data app learns its viewer's scope only from what their permissions let it read (the scoped rows it gets back): it sees no user attribute.
- A scoped viewer sees no more through Metabase than the source shows them. Every published table a scoped group reaches carries the scoping column, or holds nothing the source keeps from that scope (a product list, a `cfg_` table); the handoff names each table of the second kind.
- A viewer whose scoping value is null sees what the source shows them. Row-level security answers that viewer with an error that the query requires a user attribute, so where the source shows them every row, the handoff puts them in a group with unrestricted view data on the scoped tables.
- Whether the app's questions honour row-level security is known only from the check at handoff (_Row-level security at handoff_): until it passes, the handoff calls scoping unproven.
- When the source scopes by login alone, with no filter a viewer controls, the app has no filter for it either: its figures per scope come from row-level security, which the dev preview's admin key never applies. Parity handles those rows (`parity.md`, _Scopes only row-level security applies_).

When scoping changes what a figure means (a customer's first order counted within one branch rather than overall), the transform keeps the source's grain. A figure computed per entity can't be summed across scopes (a new customer, a repeat buyer, a cohort): where the source shows it for all scopes too, that grain is a table of its own, never rows with a null scoping column, and a scoped group gets no access to it.

### Row-level security at handoff

The user's step 6 (`handoff.md`), on the target instance, before any viewer is let in:

- Row-level security on the scoping column for each scoped group, on each table it applies to. The handoff names each table, and each published table a scoped group reaches that has no scoping column.
- Each table that holds every scope's figures together: scoped groups and All Users get no access to it, and the handoff names each one.
- Metabase applies it only when the user is in no group with unrestricted view data on that table, All Users included. So unrestricted view data on those tables goes only to groups with no scoped user in them: the viewers the source shows every row to, including any whose scoping value is null (`spec.md`, _Scoping_). All Users is blocked on them.
- Blocking All Users on any table also removes native SQL on the whole database from users whose only access comes from All Users: name them, and give them a group of their own first.
- The scoped users have no unrestricted access to the source tables either, which hold the same rows.
- The check: an account in exactly the groups a real scoped user has. The app shows only their rows, and a query on a source table, or on a table that holds every scope's figures together, returns only their rows or is refused.

## Constants

A constant the source shows or computes with (a monthly target) becomes a `cfg_` table: a transform selects the value as a row, with its validity dates where it has them, and its table is published, so Metabase returns it like any other value. Changing it is then a reviewed change to the transform. A threshold inside a rule (stock below 10) goes into the segment or transform that applies it.

## Pages

How the widgets group into the app's pages is the user's decision at the phase 4 checkpoint (`checkpoints.md`): a source's analytics often sit on pages built for other work, spread across many of them. The memo shows each source page with its widgets and what else the page is for, then offers:

1. **By what each page is for:** the default. A source page that is analytics (a dashboard, a report) keeps a page of its own, with its title. The widgets of the pages built for other work (a list of users, a record's page, a form) share one page, in sections named after those pages, since each would bring only a widget or two. Pages and sections keep the source's order.
2. **As the source:** one page per source page that shows analytics, with its title, in the source's order.
3. **One dashboard:** every widget on one page, in sections named after the source's pages.
4. **By subject:** pages you propose from what the widgets measure (sales, stock, customers), each listing its widgets by `W<n>`.

The user may also move single widgets, or name pages of their own. The answer is a `D<n>`, and the brief's pages follow it. When the pages move whole with their lists and actions (`records.md`), they are the source's, and this isn't asked. Whatever the grouping:

- A widget on several source pages shows once on each app page that takes one of them.
- A record's page (a product's figures) keeps its record filter: the viewer picks the record among those the source's page opens.
- Each filter reaches the widgets it reached in the source and no others, so the filters of two source pages put on one app page stay apart.
- A page or widget only some roles see goes into an app of its own (_Scoping_), whatever the grouping.

## The app's brief

The end of `plan.md`: what the app must show, as the user's requirements for the data-app skills (`data-app` and the skills it names). It says which values the app shows and its colours, never how it is built or drawn: no questions, hooks, components, controls or visualizations.

- **Pages:** as `decisions.md` groups them (_Pages_): each page's title and its widgets, each by `W<n>` and the source's label, which names it, with the values it shows: a figure, a series and its grain, a table's columns and which rows (a top N by its sort and tiebreaker), and the figures its caption states.
- **Numbers:** for each widget, the Library objects that carry it, and, only where no table holds the figure (_Data path_), the arithmetic over the values Metabase returns, citing the code.
- **Filters:** one per `F<n>`: its options and where they come from, the value a page opens on, the widgets it reaches and those it doesn't, and whether it keeps its value across pages. A date filter adds _Date windows_' requirements.
- **Outside APIs:** each call the source makes, its host, and what the source does with each response, a failure included.
- **Look:** the colours phase 4 chose. Like the source: the palette and each widget's colours from `inventory.md`, _Look_. Like the instance: its `application-colors` setting (`mb setting get application-colors --json`), where unset means Metabase's own colours. The user's own: the colours they gave. The data-app skills apply them wherever the theme and a chart's settings take them; the source's layout and chart library stay out, and no colour is part of parity.
- **Scoping:** the unscoped viewer's page (_Scoping_).
- **Lists and actions,** when the pages move whole: as `records.md` says.
