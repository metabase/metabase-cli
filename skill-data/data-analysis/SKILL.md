---
name: data-analysis
description: Answer real questions from clean, analysis-ready tables and hand back a plain-language report - an answer-finding task, not chart-building. Read the tables, turn the user's question into queries, run them on the live instance, sanity-check the numbers, write up findings the user can trust. Works over already-clean (wide, human-readable) data - survey/registration answers, event signups, customer lists, anything where the data holds the answer. Use when someone wants to "answer questions about my data", "report on who registered / signed up / responded", "what did people say", "analyze X", "explore this data", or "build me a report". For a non-technical user who knows their domain. Needs charts/dashboards? Use `visualization`. Tables still raw? Use `data-transformation` first.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Data Analysis

> **Shared contract (read first).** This skill is part of the `robot-data-engineer` family and follows its shared rules: audience is a non-technical user, so no database jargon (skip "normalize"/"grain"; ERD/foreign key are fine; explain "wide"/"long" the first time you use them). Ask before showing PII row-by-row (names, emails, phones) — default to aggregates. When asked for something the CLI can't do (alerts, dashboard filters), name the limit instead of erroring into raw SQL. Honor the autonomy mode the user picked. Full text and the autonomy slider live in the router — run `mb skills get robot-data-engineer` and read its **Shared Contract** if you haven't.

The user has a question and clean data that already holds the answer. Your job: find the answer, check it's right, and hand it back in plain language. You're an analyst, not a dashboard builder — the deliverable is a **trustworthy written answer**, optionally backed by a saved question they can re-open.

This skill assumes the tables are already clean (wide, human-readable). If they're raw and normalized — lots of `*_field`/`*_choice` lookups, coded columns, JSON blobs — stop and route to `data-transformation` first; don't analyze on top of a mess.

---

## The loop

For each question the user asks:

1. **Find where the answer lives.** List tables (`mb table list`, `mb db schema-tables <db> <schema>`). Read the columns (`mb table fields <id>`). Clean datasets often ship the same facts two ways — a **wide** table (one row per thing, easy to read) and a **long** table (one row per attribute, easy to aggregate over many-valued answers). Pick the one that fits the question: per-person facts → wide; "which option was most popular" across a multi-select → long.

2. **Turn the question into a query.** Write it, run it (`mb query`). Start small — a `count(*)` and a couple of sample rows to confirm you're pointed at the right table and the columns mean what you think. Then write the real query.

3. **Sanity-check before you believe it.** A number with no cross-check is a guess. Confirm row counts against a total you trust, watch for nulls/blanks inflating or deflating a percentage, and re-read the column you grouped on — a `type/Category` column with "confirmed"/"cancelled" means your "how many registered" answer depends on which statuses you counted. State the denominator.

4. **Report in plain language.** Lead with the answer, then how you got it. Numbers get context ("9 of 10 confirmed"), not bare figures. For free-text answers, quote a few real responses rather than only counting them — the words are the value.

---

## What to ask the user up front

Don't over-interrogate, but settle the things that change the answer:

- **Scope.** All-time or a window? Everyone, or only confirmed/active? A "how many registered" with no status filter and a "how many _confirmed_" are different numbers — pick the one they mean, and say which you used.
- **Cut.** Do they want the headline number, or the number broken down (by role, by company, by version)? A breakdown is usually one `GROUP BY` away and far more useful.
- **Form of the answer.** A number in chat? A short written digest? A saved question they can re-open and refilter? If they want something durable or visual, that's the `visualization` skill — hand off.

When genuinely unsure which interpretation they mean, ask — never silently pick one and present it as the answer.

---

## Survey / registration data — the common shape

A lot of "analyze who registered / what did people say" work lands on event or survey data, which has a recognizable shape worth calling out:

- A **per-registrant wide table** — name, company, role, status, plus one column per single-answer question. Use it for "who registered", rosters, breakdowns by role/version/company, and any per-person filter.
- A **long answers table** — one row per (registrant, question, answer). Use it for **multi-select** questions (one person picks several options, so they can't flatten into one wide column) and for "which option was chosen most". Group by the question text, then by the answer value.
- **Question definitions** — the catalog of what was asked, the answer choices, free-text vs single vs multi. Read this first to know which questions exist and how each is typed before you start counting.

Three report families cover most asks:

1. **Roster** — who registered, with the facts that matter (company, role, status). A filtered, ordered read of the wide table.
2. **Distribution** — how the group splits on a single-select (role, version, customer-or-not). A `GROUP BY` with counts; the agent-facing answer is "X% picked A, Y% picked B".
3. **Open-ended digest** — what people said in free-text ("what do you want to learn / teach / discuss"). Small N usually — list the actual answers, don't just count them; the responses are the point.

---

## Don't

- **Don't analyze raw, un-cleaned tables.** If the data is normalized/coded/JSON, route to `data-transformation` first and analyze the clean output.
- **Don't report a number you didn't sanity-check.** No denominator, no null-check → no answer.
- **Don't silently pick a scope.** "Registered" vs "confirmed", all-time vs window — state which you used, or ask.
- **Don't build charts/dashboards here.** A written answer (and maybe one saved question) is the deliverable; if they want it visual, that's `visualization`.
- **Don't only count free-text.** Quote the real responses — the words carry the insight a count throws away.
