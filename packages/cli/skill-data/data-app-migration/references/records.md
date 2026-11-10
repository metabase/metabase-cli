# Records: pages that pair analytics with lists and actions

Many admin screens put a chart above a list of records the viewer manages: users with edit and delete buttons, invoices with a void action. A data app can carry such a page whole: its lists read the Library like any widget, and its actions write through a table action (`data-app-actions`) or a call to the source's own backend (`data-app-ui`, _External APIs_). Whether they move is the user's choice (_The question_); this file is how you find out what moving them takes, and what it changes.

## In the probe

On a page that mixes analytics with a record screen (`probe.md`, _Where analytics live_), record the rest of the page in `inventory.md`, _Records_, following each to the database as `probe.md`, _Following the data_, does for a widget:

- **Each list** `L<n>`: its columns as shown; which rows (its filters, and what the model adds, such as a soft delete hidden); its sort and tiebreaker; its page size; its search (the columns it matches and how: contains or prefix, with or without case); and the filters that reach it.
- **Each action** `A<n>`: its trigger (a row's button, a form, a selection of rows) and its inputs, then its handler: the route and method; each table and column it writes, and which rows (by primary key or otherwise); the value each column gets (a viewer's input, a constant, the clock, something computed); each check it makes beyond the database's own constraints (an input's format, a condition on the row, such as only draft invoices); and each effect beyond that write (another table, an audit row, an email, a call to another service, a job queued).
- **How the backend answers a browser on another origin:** its CORS setup (the origins it allows, with credentials or not), how it authenticates (a session cookie and its `SameSite`, a bearer token), and any CSRF check. A value in a settings file follows _Before you start_'s permission.

A screen that manages the source app's own logins or configuration (its admin accounts, its settings page) stays behind: a data app's viewers are Metabase users. Record it under _Not analytics_.

## What a data app can carry

Once phase 2 has located the database, give each action the first of these that fits, beside it in `inventory.md`:

- `TABLE`: a table action does all the handler does. It writes one row of one table by its primary key, setting columns to the viewer's inputs, constants or the clock, with no effect beyond that row and no check beyond the database's constraints, except a condition on the row's own values, which the app keeps by offering the action only on rows that meet it. A soft delete is a `row/update` of its column, never a `row/delete`. The table is a source table that can be published as it is (`mapping.md`, _What gets published_), since a transform's next run would overwrite a write to its table, and it has exactly one primary key.
- `BACKEND`: the app calls the handler's route through `allowed_hosts`, which keeps the source's checks and effects. Only where the code shows the route answers the viewer's browser from the data app's origin: CORS allows that origin, and its authentication works from another site. Otherwise it needs a change to the source's backend, which is the user's to make: name what it takes.
- `APPROX`: a table action that skips what the handler does beyond the row write, each skipped check or effect named: kept with that difference, or left in the source.
- `NONE`: nothing above fits (several rows, a row matched by another column, a table holding a credential, an effect no table action has and no reachable route): the action stays in the source.

A list takes a widget's verdict (`spec.md`, _Verdicts_).

## The question

When a page mixes analytics with a record screen and at least one of its actions isn't `NONE`, ask what moves, at the end of phase 2, as a question of its own with no default. A request that says "the charts", "the analytics" or "the dashboards" doesn't answer it: those name what the user knows to ask for, not a choice between the two. Only a request that names the lists or the actions themselves, to move them or to leave them, does. The options:

- **The analytics only:** the charts, KPIs and reporting tables move; the lists and actions stay in the source; the pages group as `mapping.md`, _Pages_, has it.
- **The pages, with their lists and actions:** the app follows the source's pages, each with its widgets, its lists and the actions a data app can carry. A table action writes to the source database directly, through Metabase's connection.

Lead with each page, its widgets, lists and actions, and each action's verdict with what it skips or needs: the `APPROX` differences, the `BACKEND` routes and the change each waits on, the `NONE`s and why. Record the answer as a `D<n>`. When every action is `NONE`, nothing is asked: the analytics move alone, and the phase 4 memo says why the actions stay.

## When the pages move whole

- **Pages:** the source's, one app page per source page in its order, each holding its widgets, lists and actions as the source places them; a page of links only (an overview) is the app's navigation. Phase 4 doesn't ask how pages group, and asks instead about each `APPROX` action: kept with its difference, or left in the source.
- **Spec:** each list's rules as a widget's (`spec.md`), and each action's: the rows it writes, each column and the value it gets, and the condition on the row the app keeps, each cited.
- **Data side:** each list reads a published table, with a segment for the rows the source shows (a soft delete hidden). Each table an action writes is published as it is, needs data actions on its database (`data-app-actions`, _Data actions on the database_), and a connection login that may write it (`connect.md`). The plan checkpoint names those tables, and that turning data actions on lets anyone with access to the actions write to them.
- **Brief:** for each list, its columns, rows, order and tiebreaker, page size, search and filters; for each action, its trigger and inputs, the rows it is offered on, what it writes (table, columns, values) or the route it calls and what the source does with each response, its confirmation, and the lists and widgets it refreshes.
- **Parity:** a list's rules are pinned as a widget's (`parity.md`). Each action's unit test (`data-app-testing`, _Actions_) checks the columns and values it sends against `spec.md`, and a backend call's test mocks each response the source handles. The end-to-end specs open each form and submit none: the preview's database is the live one.
- **Handoff:** each action that moved, how, and what it writes; data actions on the target's database when it's another instance (`handoff.md`); the backend change each `BACKEND` action waits on; each action left in the source, and why.
