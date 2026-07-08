# Missing skills

Three skills should be added, in priority order: **`native-sql`**, **`metadata`**, and **`dashboard`**. Each closes a gap where the `mb` CLI exposes real capability, the knowledge to use it correctly is non-obvious, and no existing skill covers it. A handful of smaller gaps are better fixed by extending `core` and `data-workflow` than by new skills, and several large Metabase topic areas are deliberately excluded because the CLI has no commands for them.

The bar applied throughout: a skill must carry judgment, workflow, or a hard-to-guess contract that an agent gets wrong without it — not restate an endpoint the `mb __manifest` already documents. Complex API surfaces (like MBQL) qualify; plain CRUD does not.

## Current coverage

Seven user-facing skills ship today: `core` (foundations + per-resource footguns), `data-workflow` (the end-to-end analyst router, with `building-clean-tables` / `reusable-definitions` / `answering-questions` references), `mbql` (MBQL 5 query bodies), `visualization` (chart `display` + `visualization_settings`), `document`, `git-sync`, `transform`. Together they cover MBQL authoring, chart rendering, transforms/ETL, documents, and version control.

The ideal the skills exist to reinforce is one semantic-layer hierarchy: **transforms build clean tables → segments and measures are defined on them → metrics and questions build on those → dashboards sit on top.** There is no separate "model" layer — a curated table _is_ a transform output. `data-workflow` already routes along this arc; the gaps below are the layers where the CLI can do meaningful work that none of the current skills teach.

---

## 1. `native-sql` — the SQL counterpart to `mbql`

**Trigger / when-to-use:** "write a SQL question", "add a filter widget to my SQL", "parameterize this query", "use a field filter", "reference a saved question in SQL", "use a snippet", "why is my `{{variable}}` returning no rows".

**The gap.** `mbql` is the query-body skill, but it is MBQL-only — it explicitly punts on native SQL ("skips pre-flight"). Native SQL only appears elsewhere as embedding mechanics (`transform`) or a one-line "native template-tag ids" aside (`mbql`). Yet the CLI authors native SQL as a first-class surface: `card create` / `card update` with a native `dataset_query`, `transform` native sources, and `snippet`. The entire template-tag / parameter layer is undocumented.

**Why it's non-obvious (not an API restatement).** Native SQL parameterization is a genuinely complex, error-prone contract — the SQL analogue of MBQL that the user's own rule says "deserves to be described":

- **Template-tag types** (`src/metabase/lib/schema/template_tag.cljc`): `:text` / `:number` / `:date` / `:boolean` raw-value variables vs. `:dimension` **field filters** vs. `:card` (referencing another question, `{{#123}}`) vs. `:snippet` (`{{snippet: name}}`). Each has a different body shape and a different `parameter_mappings` target — a raw variable maps as `["variable", ["template-tag", tag]]`, a field filter as `["dimension", ["template-tag", tag]]`. Getting the pair wrong silently breaks the filter.
- **Field filters vs. basic variables** (`docs/questions/native-editor/field-filters.md`, `sql-parameters.md`): the single biggest native-SQL mistake per the docs. A field filter needs `:dimension` (a `[:field {} id]` ref) plus a `:widget-type`, and is written bare in SQL (`WHERE {{created_at}}`, not `WHERE created_at = {{created_at}}`); a basic variable is a literal substitution. Using a basic variable where a field filter belongs loses the date picker, the dropdown, and the dashboard mapping.
- **Widget-type ↔ parameter-type alignment**: the field filter's `:widget-type`, the dashboard parameter `type`, and the column's semantic type all have to line up (`allowed-for` sets in the backend). Mismatches produce empty or malformed widgets.
- **Referenced saved questions use _default_ parameter values, not live ones** — a documented footgun that makes `{{#123}}` results surprising.
- **Case-sensitivity and the read-only rule**: `WHERE plan = {{p}}` matches zero rows on Postgres if case differs; DDL / multi-statement SQL is unsupported.

**Shape.** `SKILL.md` covering the template-tag taxonomy, the field-filter-vs-variable decision, the map-to-dashboard target table, and the author→run loop; a `references/template-tags.md` with the per-type body catalog and the widget-type/parameter-type alignment table. Cross-links: `mbql` (its opposite number — when MBQL can express it, prefer MBQL), `dashboard` (mapping a field filter to a dashboard filter), `visualization`, `core`.

---

## 2. `metadata` — semantic types and the field/table metadata that powers everything downstream

**Trigger / when-to-use:** "set this column as a currency / email / category", "mark this as a foreign key", "make this column show a dropdown", "why doesn't the query builder suggest a join", "hide this column", "set the entity key", "the linked filter shows values that shouldn't be there".

**The gap.** `core` has one line: "`field update` is where you set a column's `semantic_type` or foreign-key target." `data-workflow/building-clean-tables` sets metadata as workflow steps. Nothing enumerates the semantic-type catalog or explains the causal chain from a metadata edit to the feature it unlocks. The CLI fully supports this (`field update`, `table update`), and it is cross-cutting — the same metadata drives joins, dashboard filters, dropdowns, and display everywhere.

**Why it's non-obvious.** Metadata is a small set of fields with large, indirect, easy-to-get-wrong consequences (`src/metabase/types/core.cljc`, `warehouse_schema/models/field.clj`, `docs/data-modeling/semantic-types.md`):

- **Semantic types are labels, not casts** — the top misconception in the docs. Setting `:type/Quantity` on a text column does not make it numeric; it only changes formatting and widget selection. Actual casting needs an expression or a transform.
- **The closed enum surface** an agent needs pinned: `:type/Category`, `:type/Email`, `:type/URL`, `:type/Currency`, `:type/City`/`State`/`Country`/`ZipCode`, `:type/Latitude`/`Longitude`, the timestamp semantics, plus the **relation** types `:type/PK` / `:type/FK` that live in the same `semantic_type` column but a different hierarchy.
- **The causal chain**, which no skill states: `fk_target_field_id` → implicit joins **and** dashboard linked filters **and** query-builder join suggestions; `has_field_values` (`auto-list` / `list` / `search` / `none`) → dropdown-vs-search widget and whether values get scanned; `visibility_type: sensitive`/`retired` → **blocks the query entirely** (not just a UI hide); entity key → detail view and record search.
- **Linked filters depend on table-metadata FKs, not joins defined inside a saved question** (`docs/dashboards/linked-filters.md`) — a subtle cross-feature dependency that explains a whole class of "the filter shows wrong values" bugs.

**Shape.** `SKILL.md` with the metadata-edit → downstream-feature map and the "semantic types aren't casts" rule; a `references/semantic-types.md` cataloging the enum with when-to-use. Cross-links: `dashboard` (FKs → linked filters), `mbql` (implicit joins via FK targets), `data-workflow`.

---

## 3. `dashboard` — building interactive dashboards, not just laying out cards

**Trigger / when-to-use:** "wire a filter to these cards", "make a filter cascade / linked filter", "click a bar to filter the rest", "add a tab", "add a second series to this chart", "make clicking this row open another dashboard".

**The gap.** The dashboard _mechanics_ exist — `core` has a dense paragraph on the 24-column grid, `parameters` array, and `parameter_mappings`; `visualization/references/settings.md` documents `click_behavior` on dashcards. But the pieces are scattered and there is no **workflow/judgment layer** for turning a set of cards into an interactive app. The CLI supports all of it (`dashboard create`/`update`/`update-dashcard`/`parameter-values`), and the wiring is where agents fail.

**Why it's non-obvious.** Interactive dashboards are a system of interacting parts with strict, documented constraints (`docs/dashboards/*`, `dashboards/models/dashboard_card.clj`):

- **The full filter-wiring loop**: define a `parameters` entry, then map it on every target dashcard's `parameter_mappings` — a parameter with no mapping does nothing, and editing replaces the whole array (read-modify-write). This is stated in `core` for mechanics but not as a workflow.
- **Linked (cascading) filters** work only on real database columns joined by **table-metadata FKs**, never on custom columns or joins defined inside a saved question — the deep reason lives in the `metadata` gap above.
- **Cross-filtering** (click a chart to filter others) has a specific recipe: the driver chart stays unmapped, all followers map to the parameter, via `click_behavior: crossfilter`.
- **Series** (`:series`) work only on line/area/bar; **time-grouping parameters** only bind to a datetime column in the query's _last_ stage; **click behavior** (`crossfilter` / `link` to card/dashboard/url) is authored only on dashcards and is inert on a standalone card.

**Shape.** `SKILL.md` for the wiring workflow and the interactivity decision tree (filter vs. linked filter vs. cross-filter vs. click-through), pulling the scattered mechanics into one place and adding the judgment; reuse `visualization`'s `click_behavior` reference rather than duplicating it. This is the largest single gap by surface area. Cross-links: `visualization` (the cards themselves), `native-sql` / `metadata` (what makes a column filterable), `core`.

---

## Better as enhancements than new skills

These gaps are real but too thin for their own skill — the fix is a few sentences in an existing one:

- **Collections / organization** → extend `core`. Add: official collections via `authority_level` on `collection create`; moving items by patching `collection_id`; the dashboard-vs-collection reusability trap (a question saved to a dashboard can't be reused). The rest of the docs' organization material (verification, pinning, bookmarks) is UI/EE and not CLI-exposed.
- **Card execution — parameters & exports** → extend `core` (or a short section in `native-sql`). The `--parameters` shape passed to `card query`, and `--export-format csv|xlsx` streaming, are slightly non-obvious but small.
- **Search strategy** → already adequately handled by `core`'s "search vs. list" note.

---

## Deliberately not skills (the CLI has no commands for them)

These are large, high-value Metabase topic areas with genuine user pain — but there is no `mb` command surface, so a skill would only teach an agent to attempt something and hit a wall. `data-workflow` already instructs agents to name the limit and offer the nearest CLI-doable thing. Listed so the decision is on record, not overlooked:

- **Permissions & data sandboxing** — groups, data/collection permissions, row/column security. No `permission`/`group` noun. (Backend exists: `permissions/models/*`.)
- **Alerts & subscriptions (pulses)** — threshold alerts, scheduled dashboard email/Slack. No `alert`/`pulse` noun. (`pulse/models/pulse.clj`.)
- **Actions & writeback** — form-driven inserts/updates. No `action` noun. (`actions/schema.clj`.)
- **Embedding & sharing** — public links, signed/interactive embedding. Partly settings-driven, but no authoring surface.
- **Caching & performance** — cache policies. Settings-adjacent only; no workflow surface.
- **Admin config** (email/Slack, timezone, localization, appearance) — reachable only as raw `setting set` JSON, which is obvious API, not a skill. Revisit only if setting-driven configuration becomes a real multi-step workflow.
