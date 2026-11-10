# Checkpoints: what the user is asked, and how

Every question goes through `AskUserQuestion`, which takes up to four questions a call. Lead with a short recap of only what the answers turn on. Mirror the user's words; Metabase's terms (question, segment, measure, metric, transform) are fine, warehouse jargon isn't. Name each widget by its label as the user sees it, with its `W<n>`. Answers go into `decisions.md` at once, each a `D<n>`.

## Before you start

One call, holding only what the user's request hasn't said (`SKILL.md`, _Before you start_). A check that needs the user's yes, such as creating or syncing the Library, is asked once the checks have run.

## Phase 4

Print the memo, then ask. The memo, in this order:

- **The pages:** each source page with its widgets and what else the page is for; each app of its own for pages or widgets only some roles see (`mapping.md`, _Scoping_); and one line naming the screens left out as not analytics (`probe.md`, _Where analytics live_).
- **Left out:** each `NONE` widget, with what is missing and what would unblock it (`spec.md`, _Verdicts_).
- **The decisions,** numbered, each naming the widgets it touches, what it changes, the default and why — the source's behaviour wherever the source has one — and what changes if the default is wrong. An `APPROX` is one plain sentence and one example from its fixture rows ("for an order refunded the same day, the source shows 12, the app 11"), with its attempt cited in `spec.md`.
- **The findings,** one line each, grouped by kind (test data, definitions of one number, statuses, scope), each built as the source does it, and each the user's to change by asking.
- **Who sees what,** with the permission steps it leaves to the user at handoff, and each published table that holds every scope's figures together, which whoever reads the Library sees.

Then the questions, in this order, a second call taking what the first has no room for:

1. the pages (`mapping.md`, _Pages_), the default grouping first, unless they move whole (`records.md`), and each app of its own for a role, with what it costs: one more app to build, test and release;
2. how fresh, `hourly` first, each option naming the job it turns on, if any (`SKILL.md`, phase 4);
3. how the app looks, like the source first (`mapping.md`, _The app's brief_);
4. each decision with no default, as a question of its own: each `UNKNOWN`, an environment variable's code default shown but never taken as the answer;
5. "Accept the rest as listed?", naming their numbers, when any are left.

## Phase 5

Lead with what the yes allows, then the rest:

- where the transforms write: the database by its display name, the schema, and the tables they create;
- what publishing opens (`mapping.md`, _What gets published_): every group that can read the Library can query each published table, and one with unrestricted view data on the database reads all its rows from phase 6 on; Admin → Permissions shows which groups those are;
- when actions move (`records.md`), the tables they write, and turning data actions on for their database, which lets anyone with access to the actions write to them: this yes covers `data-app-actions`' question;
- the branch the work goes to, the `git switch` in the repository, the exports, the release's push and import, the admin API key the dev preview needs and, where an existing `<repo>/.env.local` holds a refused key, moving it aside unread until handoff (`data-app`, _Dev preview_): one yes covers each of them for this plan, where `data-app` or `git-sync` would ask for it too;
- where transform tests are unavailable, the rules that stay `unverified`, and whether a read-only replica exists to compare on (`parity.md`, _The comparison on a copy_), no by default;
- the counts of objects (transforms, published tables, segments, measures), the app's slug, and the path to `plan.md` for the full list;
- "Build this plan?".

## After phase 5

One checkpoint before release, in phase 4's form, for what building found; when building found nothing, record that and go on:

- each `APPROX` (`spec.md`, _Verdicts_), with the verdict matrix updated.

Asked when they come, before anything is done: a data-side change the app needs (`SKILL.md`, phase 7) that adds a transform or publishes a table, and an export beyond the plan's (`SKILL.md`, _Rules for every phase_).

## As they arise

Phase 2's choices of database and of what moves (`records.md`, _The question_), a connection that turns out unable to write (`mapping.md`, _Transforms_), and a database to connect (`connect.md`): the options, each with what it costs; then which one. The choice of database says that the app shows the chosen database's data, and that transforms write their tables into it (`mapping.md`, _Transforms_), adding load on each run.
