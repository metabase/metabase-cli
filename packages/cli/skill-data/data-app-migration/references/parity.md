# Parity: prove the numbers from the code

Phase 6 for the data side, phase 8 for the app. Every rule `spec.md` lists for a kept widget is pinned by a check that passed — a transform fixture test, an app unit test, or a compiled-SQL check — or is `unverified` or pending a scoped user's check, as below. The proof rests on the source's code, never on the source's data: no query of yours reads the application's rows, apart from the session's time zone (`SKILL.md`, phase 2) and the comparison on a copy at the end of this file. Release waits on it.

## The fixture folder

At the start of phase 6, make a folder outside every repository with `mktemp -d`, and record its path in `plan.md`. Every transform test body you write goes there, and nowhere else. Delete the folder at handoff. A resumed migration whose folder is gone reads each kept test from the instance (`mb transform-test get <id> --full --json`) and writes the rest again from `spec.md`.

## Transform fixture tests

<!-- requires: transformTests -->

One test per transform, written before the transform runs on real tables (`transform` for the body and the `mb transform-test` verbs; `transform-test-plan` for the method). The source's code stands in for the data and for the owner that method consults: profile nothing and record no count from real data (that method's first step included), answer each question it puts to the owner from the code, and pin a bug in the source as the source has it, recorded as a finding (`spec.md`, _Findings_), never fixed, its expectation named for the finding ("refunds counted, as the source does"), so that whoever fixes it later changes the test on purpose. Read a transform as `mb transform get <id> --fields id,name,source,target --json`: `--full` also prints its database's connection details.

- **The rows:** a handful per input table, each named for the rule it hits. Every rule `spec.md` lists for the transform gets a row that hits it, and one that misses it: a status counted and one not, a row inside each window bound and one just outside, a null key, a key with no parent row, a test account, a tie in a ranking, a zero case for every aggregate. A worked example in the source's own tests or fixtures becomes rows and expected values as it is.
- **The types:** each column's type from Metabase's metadata (`mb table get <table-id> --include fields`), cast for the engine as `transform` says.
- **The expected rows:** worked out by hand from the source's code, line by line, the arithmetic written in each expectation's name, with teeth proven as `transform-test-plan` says, both halves where a rule lives in the transform: a corrupted expected cell, and a perturbed input cell. A straight copy or a table of constants gets the grain and conservation checks. A perturbed key shows as rows extra and missing, not as cell mismatches.
- **Run, then keep.** `mb transform-test run <id>` until it passes; a failure is fixed in the transform, never in an expected row worked out from the code. A permission or missing-schema error is a stop instead (`mapping.md`, _Transforms_). Then, with the edits that proved its teeth undone, the test stays beside its transform, and the export carries it: the rules stay pinned after handoff, and the branch passes `mb ci run`, which fails a transform added without a test. Its rows are invented, so it holds none of the application's data. Record its id in `plan.md`.
- **On any later day.** A kept test passes whatever day it runs. Where the transform reads the clock, date the rows from the day of the run (an input in `format: "sql"` that selects literal rows and reads no table), and check what depends on those dates with `empty` expectations. Only where no such test can be written, delete it once it passes (`mb transform-test delete <id> --yes`) and record why in `plan.md`: `mb ci run` then fails that transform as untested.

<!-- /requires -->

Where transform tests aren't available (`inventory.md`, phase 2), say so at the plan checkpoint. Those transforms' rules are pinned only by the comparison on a copy; the rest are `unverified`, which the plan checkpoint's yes accepts and the handoff lists.

## App unit tests

In the app, beside its other tests (`data-app-testing`). Their inputs are invented to hit a rule's edge, never a figure the dev preview showed:

- **Presets:** at fixed instants, every preset's bounds, as the app computes them, are the bounds `spec.md`, _Window bounds_, gives for that instant. One instant sits just before midnight in the source's zone, one just after.
- **Thresholds:** each comparison that switches a widget's behaviour (days to months past a span), on both sides, with the source's operands.
- **Arithmetic:** each computation the app keeps, only where no table holds the figure (`mapping.md`, _Data path_), from given query results.
- **Clauses:** each panel's query applies its widget's rules: the segment, the filters the brief says reach it, the aggregation.
- **Outside APIs:** each response the source handles, a failure included, mocked as the source's code reads it.
- **Actions,** when the pages move whole: as `records.md` says.

## Compiled SQL

`mb query --dry-run` compiles a query without reading a row. Compile what the app sends: capture the query requests the dev preview makes (`POST /api/dataset` bodies, never a response: a body holds the filter values, no row) with the app's end-to-end runner (its request event, request bodies only, written to a temp file), for one preset and one scope, and compile each; the capture holds request bodies only and is deleted before any commit. A rule that rests on compiled SQL alone can also run: its compiled query as a scratch transform, its columns qualified by alias as `transform` requires (_Transform tests_) and writing into the output schema, with a test that takes the same invented rows as its source transform's; both are deleted before any export. Compile each Library measure from a body you write. Read each against the transform's columns and `spec.md`'s rule: the segment's filter, the bounds as the preset sends them, no shift of time zone, the aggregation. The app's runtime clauses arrive as a second stage over its question. Read each for what MBQL adds: `!=` keeps nulls (`<> … OR … IS NULL`), and every breakout joins the sort as a tiebreaker. Each panel's query computes its widget's variant as `spec.md` states it, whether it reads a measure or the published table: the check is the definition, not the route.

## Rendered

The app's end-to-end specs load every page in the dev preview: each panel renders rows, with no error in the diagnostics feed (`data-app`, _Dev preview_). Without a browser tool, the app's own end-to-end runner opens the tab the feed needs, printing nothing from the page. A check that nothing is loading and no error shows first waits for something the page renders, or it passes on a blank page. The preview reads the live database, so these specs assert no figure, whatever the data-app skills say about asserting values, and nothing it shows (page text, a screenshot, a failure message) is kept, written down, or used as an input: the figures are proven above, from the code. The test runner keeps what a failing spec saw and prints it (Playwright's `test-results/`, its `error-context.md` page snapshot even with traces and screenshots off, element snippets in a failure message): turn off what can be turned off, delete `test-results/` unread after every run, and read a failure for its element and error, never its figures.

Then look at each page yourself, before the release and after any change to a widget, with a browser tool or a screenshot deleted once seen, sizing the window before the page opens, since a resize can reload it: each widget drawn so it can be read, no line squeezed into a strip of its chart, no label cut off, no series named by an id. Nothing else checks the drawing. Looking is that check, and what the page shows is still never kept, written down, or used as an input. A widget that can't be read goes back to the data-app skills, which decide how it is drawn.

## Scopes only row-level security applies

When the source scopes by login alone, the app has no filter for that scope: row-level security applies it, and the dev preview's admin key never does. The clauses test pins the filter row-level security will apply (`scoping column = value`); the row is `pending scoped-user check` until the user's check passes (`mapping.md`, _Row-level security at handoff_).

## The comparison on a copy

Only when the user names one themselves — a read-only replica of the database the transforms write to, so it holds their tables too, connected to Metabase with a database user able only to read — and says yes at the plan checkpoint. Only for widgets whose source computes the number in its own SQL: run that SQL as written, beside the app's compiled query, as one query that returns the difference and no figure. A translation of ORM or application code is never compared this way: it would compare your reading with itself. Run the queries side by side (`xargs -P 4`), and say how many before they run.

## `parity.md`

| Widget | Rule (`spec.md`) | Pinned by | Result |
| ------ | ---------------- | --------- | ------ |

_Pinned by_ names the test and its case (a fixture row, a preset instant), the compiled-SQL check, or the comparison on a copy. A rule pinned by none is open, unless it is `unverified` (_Transform fixture tests_). A check that fails is open until a fix in the transform, segment, question, clauses or component makes it pass; never change an expected value worked out from the code. Only a rule no construct can reproduce goes to the user, as an `APPROX` with the attempt that failed (`spec.md`, _Verdicts_).

Close with the counts: rules pinned by a fixture or unit test, by a worked example from the source's own tests, by compiled SQL, by the comparison on a copy, pending a scoped user's check, `unverified`, and open. Release needs zero open. The handoff lists the `unverified` rules, names those pinned by compiled SQL alone, and counts those whose expected values rest on your reading alone, with no worked example from the source.
