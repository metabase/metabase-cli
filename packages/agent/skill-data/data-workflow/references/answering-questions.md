# Answer questions

> Part of the **`data-workflow`** skill — the "answer questions" stage. It assumes that skill's **Shared Contract** (how to communicate, PII, autonomy, permission-denied) and final-recap rule. Query grammars: the `mbql` skill for `execute_query`, the `native-sql` skill for `execute_sql`.

The user has a question and clean data that already holds the answer. Your job: find the answer, check it's right, and hand it back in plain language. You're an analyst, not a dashboard builder — the deliverable is a **trustworthy written answer**, optionally backed by a saved question they can re-open.

This stage assumes the tables are already clean (wide, human-readable). If they're raw and normalized — lots of `*_field`/`*_choice` lookups, coded columns, JSON blobs — stop and route to the **build-clean-tables** stage first (`references/building-clean-tables.md`); don't analyze on top of a mess.

---

## The loop

For each question the user asks:

1. **Find where the answer lives.** List tables with `browse_data` (`{action: "list_tables", database_id: 1, schema: "public"}`), then read the columns with `{action: "get_fields", table_ids: [9, 12]}` — one call covers several tables, and each field comes back with its type and any foreign-key target. Clean datasets often ship the same facts two ways — a **wide** table (one row per thing, easy to read) and a **long** table (one row per attribute, easy to aggregate over many-valued answers). Pick the one that fits the question: per-person facts → wide; "which option was most popular" across a multi-select → long.

2. **Turn the question into a query.** Write it, run it — `execute_query` for a structured MBQL query, `execute_sql` for raw SQL. Start small — a `count(*)` and a couple of sample rows to confirm you're pointed at the right table and the columns mean what you think. Then write the real query. Keep a query you're iterating on in a file under `./.scratch` and pass `query_file` / `sql_file`, so the thing you finally save with `question_write` is byte-identical to the thing you tested. Query mechanics → the `mbql` and `native-sql` skills.

3. **Sanity-check before you believe it.** A number with no cross-check is a guess. There's no column-profiling tool — every check below is a query you write, and each one is cheap:

   - **The denominator.** Confirm the total you're a fraction of against a total you trust: `SELECT count(*) FROM registrations` beside the filtered count you're reporting. State the denominator in the answer.
   - **Nulls and blanks.** They inflate or deflate a percentage silently. One aggregate answers it for a column: `SELECT count(*) AS rows, count(status) AS filled, count(DISTINCT status) AS distinct_values FROM registrations` — `rows - filled` is the null count. Junk placeholders (`"N/A"`, `"-"`, `""`) hide inside `filled`, so check for them too.
   - **The column you grouped on.** Re-read what its values actually are: `SELECT status, count(*) FROM registrations GROUP BY 1 ORDER BY 2 DESC`. A status column carrying "confirmed"/"cancelled"/"waitlist" means your "how many registered" answer depends on which statuses you counted.

4. **Report in plain language.** Lead with the answer, then how you got it. Numbers get context ("9 of 10 confirmed"), not bare figures. For free-text answers, quote a few real responses rather than only counting them — the words are the value.

---

## What to ask the user up front

Don't over-interrogate, but settle the things that change the answer:

- **Scope.** All-time or a window? Everyone, or only confirmed/active? A "how many registered" with no status filter and a "how many _confirmed_" are different numbers — pick the one they mean, and say which you used.
- **Cut.** Do they want the headline number, or the number broken down (by role, by company, by version)? A breakdown is usually one `GROUP BY` away and far more useful.
- **Form of the answer.** A number in chat? A short written digest? A saved question they can re-open and refilter (`question_write`, pointing at the same file you just ran)? If they want something durable or visual, that's the `visualization` skill — hand off.

When genuinely unsure which interpretation they mean, ask — never silently pick one and present it as the answer.

---

## Survey / registration data — the common shape

A lot of "analyze who registered / what did people say" work lands on event or survey data, which has a recognizable shape:

- A **per-registrant wide table** — name, company, role, status, plus one column per single-answer question. Use it for "who registered", rosters, breakdowns by role/version/company, and any per-person filter.
- A **long answers table** — one row per (registrant, question, answer). Use it for **multi-select** questions (one person picks several options, so they can't flatten into one wide column) and for "which option was chosen most". Group by the question text, then by the answer value.
- **Question definitions** — the catalog of what was asked, the answer choices, free-text vs single vs multi. Read this first to know which questions exist and how each is typed before you start counting.

Three report families cover most asks:

1. **Roster** — who registered, with the facts that matter (company, role, status). A filtered, ordered read of the wide table.
2. **Distribution** — how the group splits on a single-select (role, version, customer-or-not). A `GROUP BY` with counts; the answer you hand back is "X% picked A, Y% picked B".
3. **Open-ended digest** — what people said in free-text ("what do you want to learn / teach / discuss"). Small N usually — list the actual answers, don't just count them; the responses are the point.

---

## Don't

- **Don't analyze raw, un-cleaned tables.** If the data is normalized/coded/JSON, route to the **build-clean-tables** stage first and analyze the clean output.
- **Don't report a number you didn't sanity-check.** No denominator, no null-check → no answer.
- **Don't silently pick a scope.** "Registered" vs "confirmed", all-time vs window — state which you used, or ask.
- **Don't build charts/dashboards here.** A written answer (and maybe one saved question) is the deliverable; if they want it visual, that's the `visualization` skill.
- **Don't only count free-text.** Quote the real responses — the words carry the insight a count throws away.
