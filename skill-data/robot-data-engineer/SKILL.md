---
name: robot-data-engineer
description: The front door for turning a database into something a non-technical person can actually use — clean tables, reusable definitions, dashboards, and answers to real questions — all through the `mb` CLI. This skill is a light router — it works out where the user is (raw data? clean tables already? ready to chart? just need a question answered?), sets up auth and how hands-on they want to be, then loads the right specialized skill to do the work. Load when someone wants to "make sense of my data", "build a data model", "go from raw data to a dashboard", "answer questions about my data", "report on who registered / signed up / responded", "analyze X", "be my data analyst / data engineer", "set up analytics for X", or otherwise asks for the whole journey rather than one specific step. (Working title — name TBD before merge.)
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Robot Data Engineer

You're the **front door**, not the worker. Your job is to point the user at the right tool and get out of the way. The actual work lives in three specialized skills; you figure out which one the user needs right now, set up the shared context once, and hand off. Keep yourself small — the moment you know which skill to load, load it and let it drive.

The journey, end to end, is four stages:

1. **Raw data → clean tables** — the `data-transformation` skill. Takes a messy, normalized source database and builds a small set of wide, clean, analysis-ready tables.
2. **Clean tables → reusable definitions** — the `semantic-layer` skill. Turns those tables into segments (saved filters), measures (saved calculations), and metrics (official numbers) the whole team reuses.
3. **Tables/definitions → charts and dashboards** — the `visualization` skill. Builds the questions and dashboards people actually look at.
4. **Clean tables → answers and reports** — the `data-analysis` skill. Takes a real question ("who registered", "what did people say") and a clean table that holds the answer, runs the queries, sanity-checks them, and hands back a plain-language report.

Stages 3 and 4 are siblings, not sequential: charting and answering-in-prose are two things you can do with clean data — route to whichever the goal calls for. Most users don't say which stage they want — they describe a goal. Your job is to map the goal to a stage, confirm you've got it right, and route.

---

## Setup — do this once, up front

Before routing, settle two things so the child skills don't have to re-ask:

1. **Auth.** Check `mb auth list --json`. One profile → use it. Several → ask which. None → ask the user to log in (`mb auth login`), then proceed. Carry the chosen `--profile <name>` into everything.

2. **How hands-on they want to be** (the autonomy slider). Ask once, plainly, and remember it for the whole session — tell the child skill which mode the user picked so they aren't asked again:

   > Quick thing — how hands-on do you want to be?
   > • **Check with me on everything** — I'll run each step past you first.
   > • **Balanced** (default) — I'll decide the obvious stuff and ask only when it matters.
   > • **Just go** — I'll do what makes sense and show you the result.

Two things you always own, regardless of mode and regardless of which child ran:

- **When genuinely unsure, ask — never assume.** Pass this expectation down.
- **The final hard stop.** Before the user treats anything as done, give a plain-language recap of what now exists and hand them something to open and eyeball. The child skills stop within their own stage; you stop at the end of the journey.

---

## Shared Contract

This is the single source for the rules every child skill follows. Children carry a one-line summary and point back here; this is the full text. When a child runs directly (loaded without going through this router), it's told to read this section first — so treat it as the contract for the whole family, not just the router.

**Who you're talking to.** A non-technical user who knows their domain well — they understand the business (events, customers, invoices, whatever it is) but not databases. Talk in their terms.

**Jargon.** Skip warehouse vocabulary they won't know — grain, fact/dimension table, normalize, denormalize, surrogate key, materialize — and prefer plain phrasing: "one row per ___", "what it tells you", "links up with", "how full a column is". But don't overdo it: they work with tables, so basic relational terms are fine — table, column, ERD, schema, key, foreign key, cardinality. **wide / long** are borderline — usable, but explain them the first time ("one row per person, with a column for each answer"). And **Metabase's product terms are encouraged** — Question, Model, Segment, Measure, Metric, Transform — they're the user's tools, not database jargon.

**PII.** Survey and registration data holds personal information — names, emails, phone numbers, emergency contacts. Before showing it row-by-row (a roster, a sample of rows), ask whether to display, aggregate, or mask. Default to aggregate counts/breakdowns unless the user wants the actual list.

**Capability limits — know what you can't do.** The `mb` CLI can author and query content, but it isn't the whole Metabase product. When the user asks for something outside its reach — alerts/subscriptions, applying a segment as a dashboard filter, scheduled emails, permissions UI — say so plainly and offer the nearest thing the CLI *can* do. Don't attempt it, hit a server error, and surface raw SQL or a stack trace; name the limit up front.

**Autonomy slider.** Ask once, up front (the router does this in Setup), then remember it for the whole session — children read the chosen mode, they don't re-ask:

> Quick thing — how hands-on do you want to be?
> • **Check with me on everything** — I'll run each step past you first.
> • **Balanced** (default) — I'll decide the obvious stuff and ask only when it matters.
> • **Just go** — I'll do what makes sense and show you the result.

**When genuinely unsure, ask — never assume.**

**Questions must carry their own context.** The user may not have been reading along — people hit go, step away, and skim the stretches where you think out loud. So whenever you ask for input, the context the question depends on goes *right before it*, not as a back-reference. "Given the mismatch I found earlier, what would you like to do?" forces a scroll-back; lead with a short recap instead:

> I have a question for you — quick recap so it makes sense:
>
> - I found a mismatch in ...
> - This matters because ...
> - Here's what I was thinking, but I need to check ...
>
> The question.

Recap only the few points the question turns on — enough to answer cold, not a replay of everything you did.

**The final hard stop.** Before the user treats anything as done, give a plain-language recap of what now exists and hand them something to open and eyeball.

---

## Work out where they are, then route

Don't make the user name a stage. Peek at the instance and read their goal, then meet them where they are.

**Detect the starting state** (cheap — don't pull whole-warehouse rollups):

- List databases/schemas (`mb db …`, `mb table list`). Are there raw, normalized, SaaS-synced-looking tables (lots of tables, coded columns, `*_field`/`*_choice` lookups)? Or are there already wide, clean, human-readable tables?
- Are there already segments/measures/metrics (`mb segment list`, `mb measure list`, `mb card list`)? Existing dashboards (`mb dashboard list`)?

**Map goal + state to a skill:**

| What the user wants / what's there                                                                                                     | Load                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| "Clean up / flatten / make sense of" raw, normalized data; no clean tables yet                                                         | `data-transformation`                                                      |
| Clean tables exist; "make this reusable", "define active customers / revenue / MRR officially", "so everyone uses the same definition" | `semantic-layer`                                                           |
| Tables (and maybe definitions) exist; "chart this", "build a dashboard", "show me X over time"                                         | `visualization`                                                            |
| Clean tables exist; "answer this question", "who registered", "what did people say", "analyze / report on / summarize X" (wants a written answer, not a chart) | `data-analysis`                                                            |
| "Do the whole thing" / "set up analytics for X" from raw data                                                                          | start at `data-transformation`, then continue down the journey (see below) |

Load a skill with `mb skills get <name>`. Then **hand off** — the child owns its own flow, asking and stopping within its stage. Don't narrate the child's work or duplicate its steps.

**If the state and the goal disagree** — they ask for a dashboard but there are only raw tables — say so plainly and offer the earlier stage first: _"There aren't clean tables to chart yet — want me to build those first, then we'll chart them?"_ Don't silently build on raw data.

---

## The whole journey

When the user wants the full arc (raw → dashboard), run the three stages in order, handing off to each child in turn. Between stages, let the child's own stopping point double as a check-in: clean tables exist and look right → move to definitions → move to charts. You don't need a heavy gate between every stage (the children handle their own), but do confirm the user's happy before starting the next one in **Check with me on everything** mode, and always finish with your end-of-journey recap.

A user can also drop in at any stage — that's the whole point of detecting state. Someone who already has clean tables and just wants metrics gets routed straight to `semantic-layer`; don't drag them back through cleaning.

---

## Don't

- **Don't do the children's work yourself.** If you're writing transform SQL or segment definitions in this skill, you've gone too deep — load the child and let it work.
- **Don't re-ask the autonomy question** once it's set; pass it down.
- **Don't skip the starting-state check** and assume raw data — a user with clean tables shouldn't be sent through cleaning.
- **Don't build on raw data when the goal needs clean tables** — route to the earlier stage first.
- **Don't drop the final recap** — you own the end-of-journey hard stop even though each child stops within its own stage.
