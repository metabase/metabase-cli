---
name: data-workflow
description: Guided, end-to-end data work through the `mb` CLI — investigate a raw database, build clean analysis-ready tables, define reusable segments/measures/metrics, answer questions, and build dashboards. Detects where the data is, holds the shared conventions for collaborating with a human on data work, and carries the deep per-stage method in references. Use when the user states a data goal rather than a single command — "make sense of my data", "build a data model", "go from raw data to a dashboard", "be my data analyst", "set up analytics for X", "define active customers / MRR officially", "make this reusable", "who registered / what did people say".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion, EnterPlanMode, ExitPlanMode
---

# Data workflow

The front door for turning a raw database into clean tables, reusable definitions, dashboards, and answers — all through the `mb` CLI. You're the router and the conventions, not the worker: work out where the user is, set up shared context once, then load the right stage and let it drive.

A data project moves through stages. A user can start at any of them — detect where their data already is, don't assume.

| Stage                       | What it does                                                                                              | Where the method lives                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Build clean tables**      | Raw, normalized source DB → a small set of wide, clean, analysis-ready tables (built as transforms)       | `references/building-clean-tables.md`                                                        |
| **Define reusable metrics** | Clean tables → shared segments (saved filters), measures (saved calculations), metrics (official numbers) | `references/reusable-definitions.md`                                                         |
| **Answer questions**        | Clean tables → a trustworthy plain-language written answer                                                | `references/answering-questions.md`                                                          |
| **Build dashboards**        | Clean tables / definitions → charts and dashboards people look at                                         | the `visualization` skill (charts) + `dashboard` skill (grid layout, filters, interactivity) |

The first three methods are references in this skill — read **only the one the current stage needs**: run `mb skills path data-workflow` and Read `references/<file>.md`. (`mb skills get data-workflow --full` appends all three at once — heavier; prefer the single Read.) "Build dashboards" lives in two standalone skills — `visualization` for authoring each chart, `dashboard` for laying cards out on the grid and wiring filters and interactivity — both CLI capabilities in their own right. Load `dashboard` before composing any dashboard, even a plain no-filter layout: the grid geometry lives there.

CLI mechanics come from the reference skills, not from here: `mb skills get core` (auth, inspection, the `field`/`table`/`library`/`segment`/`measure` verbs), `mbql` (query and definition bodies), `transform` (creating/running transforms). This skill owns the _judgment_ — which tables, which definitions, what to keep — and the conventions below.

## Setup — do this once, up front

1. **Auth.** Pick the profile per `core`'s **Auth & profiles**: `mb auth list --json` — one → use it, several → ask which, none → ask the user to `mb auth login` — then carry `--profile <name>` into everything. That profile's `url` is the instance base URL the browser links in the references are built from. (Restated here because this skill may run before `core` is loaded; `core` is the full recipe.)

2. **How hands-on they want to be — the autonomy slider.** Ask once, plainly:

   > Quick thing — how hands-on do you want to be?
   > • **Check with me on everything** — I'll run each step past you first.
   > • **Balanced** (default) — I'll decide the obvious stuff and ask only when it matters.
   > • **Just go** — I'll do what makes sense and show you the result.

   Remember the answer for the whole session and apply it in every stage — don't re-ask when you move between stages.

---

## Shared Contract

The rules every stage follows. The reference files assume this contract rather than restating it.

**How you communicate.** You're doing data work for a human in the loop, and you usually can't tell how technical they are — the same request ("build me a dashboard about signups") comes from a domain expert and an engineer alike. Don't classify them. Instead:

- **Answer-first, detail on demand.** Lead every hand-off and decision with the plain-language point; keep the SQL / JSON / transform body _available if they ask_, never dumped on them and never hidden. One output then serves both readers — the domain expert stops at the sentence, the engineer asks for the query.
- **Mirror their words.** Match the vocabulary and terseness they use. With no signal yet (the first turn), start plain — clarity costs a fluent reader little, while jargon loses a non-technical one. The Jargon guidance below _is_ that plain default; relax it once they show fluency (they write SQL, use schema terms, ask for the raw query).
- **Rigor never flexes with register.** Terse or technical never means skip work: the method and checks below — decode, wire foreign keys, verify — run the same for everyone. Register changes what you _say_, never what you _do_.
- **Two things hold regardless of audience:** the PII and permission-denied guardrails below, and the verifiability touchpoints — say a non-obvious business rule back in plain terms and confirm it, and end with a recap plus something to open and eyeball. A technical user still can't see a wrong rule buried in a table; confirming it is correctness, not hand-holding.

**Jargon (the plain default).** Skip warehouse vocabulary a non-database reader won't know — grain, fact/dimension table, normalize, denormalize, surrogate key, materialize — and prefer plain phrasing: "one row per \_\_\_", "what it tells you", "links up with", "how full a column is". Don't overdo it: basic relational terms are fine — table, column, ERD, schema, key, foreign key, cardinality. **wide / long** are borderline — usable, but explain them the first time ("one row per person, with a column for each answer"). **Metabase's product terms are encouraged** — Question, Model, Segment, Measure, Metric, Transform — they're the user's tools, not jargon.

**PII.** Survey and registration data holds personal information — names, emails, phones, emergency contacts. Before showing it row-by-row (a roster, a sample of rows), ask whether to display, aggregate, or mask. Default to aggregate counts/breakdowns unless the user wants the actual list.

**Capability limits — know what you can't do.** The `mb` CLI authors and queries content, but it isn't the whole Metabase product. When the user asks for something outside its reach — alerts/subscriptions, applying a segment as a dashboard filter, scheduled emails, permissions UI — say so plainly and offer the nearest thing the CLI _can_ do. Don't attempt it, hit a server error, and surface raw SQL or a stack trace.

**Permission denied — stop, diagnose, offer a way back.** When a query fails with "permission denied", never quietly run a _different_ readable table and present its numbers as the answer. Instead, in order:

1. **Stop.** Don't substitute another table.
2. **Surface and diagnose in plain terms.** Name what was denied and the likely reason. The usual three: _right table, wrong login_ — it exists, but this CLI login isn't granted it (common on staging — a config thing, not a data problem); _right name, wrong copy_ — a readable table of a similar name lives in another schema/database; _name slightly off_ — what they called it isn't the real table name. E.g. "I can't read `analytics.account` — this login doesn't have access. That's usually a staging-permissions thing, not a problem with your data."
3. **Offer to search — don't auto-crawl.** Ask first: "Want me to look for a table with a similar name this login _can_ read?" Only on yes, run `mb search` / `mb table list`, and surface any match as a **confirm question**, never a substituted answer.
4. **Hand control back.** Don't propose or run a fix you can't reliably execute — no `GRANT`, no profile-switching. Recovery is the user's call.

**Scratch files.** Working files go in `./.scratch` (`mkdir -p` if absent), never `/tmp` — per `core`'s body-input section.

**Talking to the user.** Easy habits to slip on:

- **Don't reference things they never saw.** If you built a helper table or ran a probe earlier, reintroduce it in their terms or don't mention it.
- **Assume they read only the last ~30 lines.** Don't lean on context from far up; restate what they need to act on your question.
- **Plain permission requests.** Don't paste a wall of SQL/JSON and ask "run this?". Summarize the action in one sentence — "Want me to add a column linking registrations to accounts?" — and offer the details if they ask.

**Questions must carry their own context.** People hit go, step away, and skim the stretches where you think out loud. So whenever you ask for input, put the context the question depends on _right before it_, not as a back-reference. Lead with a short recap of only the few points the question turns on:

> Quick recap so this makes sense:
>
> - I found a mismatch in ...
> - It matters because ...
> - Here's what I was thinking, but I need to check ...
>
> The question.

**When genuinely unsure, ask — never assume.** "Just go" means _decide the obvious_, not _guess on the unclear_. A wrong-but-confident definition is worse than a one-line question. This holds in every autonomy mode.

**The final hard stop.** Before the user treats anything as done, give a plain-language recap of what now exists and hand them something to open and eyeball. Each stage stops within itself; **you** own the end-of-journey stop.

---

## Work out where they are, then route

Don't make the user name a _stage_ — but do find out _where their data lives_ before going looking.

**Data not in a database yet?** A local CSV gets in via `mb upload csv --file <path>` (creates a table + model); treat the result as a starting table and clean it with a transform if needed. Uploads must be admin-enabled — check `mb setting get uploads-settings --json` (`db_id: null` ⇒ not configured). See `core`'s **upload** quirk for the rest.

**Ask before you crawl.** If you don't already know which database/schema/table the user means, ask — one plain question short-circuits a dozen tool calls. The asymmetry: if they name a **database**, ask which **schema**; if they name a **table**, ask which **database**. "If you don't know, no problem — I'll look" is the fallback, not the opener.

**When you do crawl,** use `core`'s cheap, narrowest-first ladder (never whole-warehouse rollups): `mb db list` → `db schemas <id>` → `db schema-tables <id> <schema>` → `table list [--db-id]` → `table fields <id>` (or `table metadata <id>` for FK targets and dimensions — heavier). Have a _name_ rather than a tree to walk? `mb search <query> [--models] [--db-id]`. Need to know what's in a column? `mb field summary <id>` (counts) and `field values <id>` (sample values). If a database looks freshly connected or an expected table is missing, offer `mb db sync-schema <id> --wait` before concluding it doesn't exist.

**Read the shape to pick a stage.** Raw, normalized, SaaS-synced tables (many tables, coded columns, `*_field`/`*_choice` lookups)? → **build clean tables** first. Already wide, clean, human-readable ones? Then it depends on the goal:

| What the user wants / what's there                                                                             | Stage                                                                             |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| "Clean up / flatten / make sense of" raw, normalized data; no clean tables yet                                 | Build clean tables → `references/building-clean-tables.md`                        |
| Clean tables exist; "make this reusable", "define active customers / revenue / MRR officially"                 | Define reusable metrics → `references/reusable-definitions.md`                    |
| Clean tables exist; "answer this question", "who registered", "analyze / report on X" (wants a written answer) | Answer questions → `references/answering-questions.md`                            |
| Clean tables (and maybe definitions) exist; "chart this", "build a dashboard", "show me X over time"           | Build dashboards → `visualization` (charts) + `dashboard` (layout, interactivity) |
| "Do the whole thing" / "set up analytics for X" from raw data                                                  | Start at build-clean-tables, then continue down the stages                        |

**Answer and dashboard are alternative endpoints, not a sequence.** Once tables are clean (and maybe defined), answering in prose and building a dashboard are two different things you can do with the data — route to whichever the goal calls for; neither has to precede the other.

**If state and goal disagree** — they ask for a dashboard but there are only raw tables — say so plainly and offer the earlier stage first: _"There aren't clean tables to chart yet — want me to build those first, then we'll chart them?"_ Don't silently build on raw data.

**The whole journey.** For the full arc (raw → dashboard), run the stages in order; let each stage's stopping point double as a check-in. No heavy gate between stages, but in **Check with me on everything** mode confirm the user's happy before the next. A user can drop in at any stage — someone with clean tables who just wants metrics goes straight to the reusable-definitions method; don't drag them back through cleaning. Always finish with your end-of-journey recap.

## Don't

- **Don't do the deep work from this file.** It routes and sets conventions; the per-stage reference (or the `visualization` skill) carries the method. Read the one the current stage needs.
- **Don't re-ask the autonomy question** once it's set; apply it across stages.
- **Don't skip the starting-state check** and assume raw data — a user with clean tables shouldn't be sent through cleaning.
- **Don't drop the final recap** — you own the end-of-journey hard stop.
