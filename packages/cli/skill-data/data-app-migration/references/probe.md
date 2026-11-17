# Probe: find every widget and where its numbers come from

Phase 1. Read the source application and write `inventory.md`. Nothing here calls Metabase, and nothing here judges a rule: record what the code does, with a citation, and leave tagging and checking to `spec.md`.

Settings files hold connection details and secrets inline, and no filter reliably tells a secret from a setting. They are `.env*`, everything under a `config/` or `settings/` folder, `*settings.py`, `*.config` and `*.config.*` (`web.config`, `next.config.js`), `wp-config.php`, `application*.yml`, `application*.yaml`, `application*.properties`, `appsettings*.json`, `*.ini`, `knexfile.*`, `ormconfig.*`, `*compose*.yml`, `*compose*.yaml`, `.npmrc`, `phpunit.xml*`, `*.tfvars`, `*.tfstate`, and keys (`*.pem`, `*.key`). A route file under `config/` (`config/routes.*`) is code: open it by its path. From a settings file, read only the line that holds a value a widget leads into, and only when the user allowed it (`SKILL.md`, _Before you start_): `rg -n -w <key> <file>`, or `jq` / `yq` on the value's path, either one through the mask below. Never the whole file. When the line doesn't settle the value (the key appears twice, or the value runs over several lines), it is an `UNKNOWN`, recorded with its key for phase 4. Never read a `.env*` file, a key or an environment variable, allowed or not: they hold the secrets, and a checkout's `.env` holds a developer's values, not production's.

Search with `rg`, or `grep -rnE` where `rg` is missing. Always exclude dependency and build folders — `node_modules`, `vendor`, `dist`, `build`, `target`, `.git`, `storage`, `public/build`, and any folder the stack's ignore file lists as generated (a dependency's file is still read by its path when a call leads into it) — logs and temp folders (`log`, `logs`, `tmp`, `*.log`), and every settings file. `grep` reads the hidden and git-ignored files that `rg` skips, so the exclusions matter most there:

```bash
rg --glob '!.env*' --glob '!**/config/**' --glob '!**/settings/**' --glob '!*settings.py' --glob '!*.config' \
  --glob '!*.config.*' --glob '!wp-config.php' --glob '!application*.y*ml' --glob '!application*.properties' \
  --glob '!appsettings*.json' --glob '!*.ini' --glob '!knexfile.*' --glob '!ormconfig.*' --glob '!*compose*.y*ml' \
  --glob '!.npmrc' --glob '!phpunit.xml*' --glob '!*.tfvars' --glob '!*.tfstate' --glob '!*.pem' --glob '!*.key' \
  --glob '!**/log/**' --glob '!**/logs/**' --glob '!**/tmp/**' --glob '!*.log' ...
grep -rnE --exclude-dir=config --exclude-dir=settings --exclude-dir=log --exclude-dir=logs --exclude-dir=tmp \
  --exclude='.env*' --exclude='*settings.py' --exclude='*.config' --exclude='*.config.*' --exclude=wp-config.php \
  --exclude='application*.y*ml' --exclude='application*.properties' --exclude='appsettings*.json' --exclude='*.ini' \
  --exclude='knexfile.*' --exclude='ormconfig.*' --exclude='*compose*.y*ml' --exclude=.npmrc --exclude='phpunit.xml*' --exclude='*.tfvars' \
  --exclude='*.tfstate' --exclude='*.pem' --exclude='*.key' --exclude='*.log' ...
```

A sweep's hits can hold a secret written into code. Pipe every sweep, and every search or read of a settings file or a doc, through this mask. It hides the credentials before an `@`, the rest of a table row that holds an address, a password quoted in prose, the default an environment variable for a secret is given, and the value after a password, secret, token or key name, without dropping lines:

```bash
sed -E -e "s#(://)[^[:space:]'\"]*@#\1***@#g" \
  -e "s#[^[:space:]'\"]*[^*[:space:]'\"]@#***@#g" \
  -e "s#^(.*\|[^|]*@[^|]*\|).*\$#\1 ***#" \
  -e "s#(([Pp]ass(word|wd)?|PASS(WORD|WD)?)[[:space:]]+([a-z]+[[:space:]]+)?[\`'\"])[^\`'\"]+#\1***#g" \
  -e "s#(env\(['\"][A-Za-z_]*(PASS|SECRET|KEY|TOKEN)[A-Za-z_]*['\"][[:space:]]*,[[:space:]]*['\"]?)[^'\")]+#\1***#g" \
  -e "s#(name=\"[A-Za-z_]*(PASS|SECRET|KEY|TOKEN)[A-Za-z_]*\"[[:space:]]+value=\")[^\"]*#\1***#g" \
  -e "s#([A-Za-z_.-]*([Pp]ass(word|wd)?|PASS(WORD|WD)?|[Pp]wd|PWD|[Ss]ecret|SECRET|[Tt]oken|TOKEN|[Aa]pi_?[Kk]ey|API_?KEY|_KEY|_key)[A-Za-z_]*[\"']?[[:space:]]*(=>|=|:)[[:space:]]*[\"']?)[^[:space:]\"';,=]+#\1***#g"
```

A `.sql` file of `INSERT` or `COPY` rows is a dump of the data, not code: never read one. Seeders, factories and test fixtures are code: they show the data's shape, never its rows. Docs (a README, a setup guide) can print a connection URL or a password: read them only through searches for what you need, masked, never whole. A file the probe follows a widget into is read whole, as it is, unless it's a settings file: a value the widget takes from one you may not open is an `UNKNOWN`, recorded with its key and asked at phase 4. So is a value from an environment variable, with the default the code gives it (`env('STORE_TARGET', 40000)`): that default applies only where the variable is unset, so it is shown, never taken as the answer. Two files hold code beside a connection URL: read a `package.json` without its scripts (`jq '{dependencies, devDependencies}' package.json`), and a Prisma schema without its `datasource` block (`sed '/^datasource/,/^}/d' prisma/schema.prisma`), whose `provider` alone is `rg -n '^\s*provider' prisma/schema.prisma`.

## Stack

Read the manifests' dependency lists at the root and in each package: `composer.json`, `package.json`, `pom.xml` / `build.gradle`, `pyproject.toml` / `requirements.txt`, `Gemfile`, `go.mod`, `*.csproj`. A build file's plugin settings can hold a database password (Flyway or Liquibase in `pom.xml` or `build.gradle`): read its dependencies alone. Note the language, the web framework, the ORM or query library, the template or front-end framework. A repository can hold several apps (a back end and a separate front end): probe each.

## Where analytics live

Analytics are what the app shows to be read: a figure, a chart, or a table that reports on the data (a total, a ranking, a report's rows, a list of recent orders on a dashboard). A screen for managing records is not, even when it lists and counts them (a list with edit or delete, a form, an import), and neither is a scheduled email or an export file. A page that mixes both brings its widgets that report, and records its lists and actions as `records.md` says, for the user's choice in phase 2. Record each screen left out under _Not analytics_ in `inventory.md`, one line each, and name them in one line of the phase 4 memo, so the user sees where the line runs.

One sweep per row. A hit is a lead, not a widget: open it and follow it. In a small app (a few controllers), reading every controller and view in full does the sweeps' work.

| Look for                   | Patterns                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes, controllers, pages | `dashboard`, `analytics`, `report`, `stats`, `metrics`, `insights`, `kpi`, `overview` in route files, controller and page names                                        |
| Chart libraries            | `Chart.js` / `new Chart(`, `echarts`, `Highcharts`, `ApexCharts`, `d3.`, `recharts`, `@nivo`, `plotly`, `google.visualization`, `vega`; also hand-drawn `<svg>`        |
| SQL aggregates             | `SUM(`, `COUNT(`, `AVG(`, `GROUP BY`, `date_trunc`, `OVER (`, `WITH `, case-insensitive, in code and `.sql` files                                                      |
| ORM and builder aggregates | `->sum(`, `->count(`, `->avg(`, `withCount`, `selectRaw`, `.aggregate(`, `annotate(`, `groupBy(`, `Sum(`, `Count(`, `func.sum`, `.groupBy(`                            |
| Math in application code   | `array_sum`, `reduce(`, `->avg(`, `->sum(` on a collection, `.mapToDouble(`, loops that accumulate totals, percentage arithmetic (`* 100`, `/ total`)                  |
| Constants                  | `target`, `goal`, `threshold`, `quota`, `budget`, `limit` in code and class constants; a value from a settings file or an environment variable, as the rules above say |
| Scoping                    | auth middleware, policies, `user()->`, `current_user`, `request.user`, `tenant`, `owner`, `where(...user...)`, a filter applied from the session                       |

## Following the data

For every chart, tile and table a view renders, follow the chain to the database, citing file:line at each hop:

1. **The view:** the element, its label as the user sees it, and what it shows: a figure, a series and its grain, a table's columns and which rows. A table's columns are the values in its cells, each its own even where two share a cell; a row number, an inline bar and a link are how it draws them, not columns. A goal line's value is a constant. The colours it sets go under _Look_.
2. **The data it gets:** a variable passed to the template, a prop, or a fetch to a JSON endpoint. For a fetch, find the route that answers it, and note what the front end does to the response before drawing it: filtering, sorting, `reduce`, defaults for missing values, unit conversion. Those are rules too.
3. **The handler:** the controller, service or resolver, and every function it calls on the way. A handler in another repository or service: ask the user for its path, noting the widget's rules as not yet read until you have read it.
4. **The computation:** the SQL, the ORM or builder chain (written out as the query it produces), or the code that computes it from fetched rows. Note what happens to the rows after the query: sorting, slicing, rounding, arithmetic, merges of two queries.
5. **Stop at the database:** the tables and columns read. The code that opens the connection is not followed: it can hold the credentials, and the engine comes from _Data sources_.
6. **What fills them:** for each table and column read, the code that writes it. Search for the table's name and its model's with `rg -l`, which prints file names only, and open the code among the hits (a migration, a job, a model), never a dump of rows: its inserts, updates and upserts, a view's or materialized view's definition and what refreshes it, a trigger, a count kept up to date on each save (Rails' `counter_cache`, a save hook or signal). Where only the app's own screens and APIs write it as people work, stop. Where a scheduled job, a command, a save hook, a trigger or a view's definition computes what the widget reads (a `daily_stats` table, an `orders_count` column), the number's rules are there: follow that code from step 3, citing file:line, and record its schedule and the clock and zone it reads. A schedule in a settings file follows the rules above. Code in another repository or service is asked for as step 3 says; a table no code in the source writes is recorded as filled from outside it.

Record along the way:

- **Each input the chain takes:** a request parameter, a filter, the logged-in user, the clock (`now()` in the database or the application, and in which timezone), a constant.
- **A comparison that switches the widget's behaviour** (a chart going from days to months past a span), exactly as written, operands and types included: an off-by-one there moves a boundary.
- **Text the page computes or states about a number** — a scope label in a heading, a caption saying what a metric counts. It is part of the widget, and a caption that misdescribes the logic is a finding.
- **A chain that branches on the user's role:** two variants of the widget. Record both, and a widget or page one role sees and another doesn't.
- **Each preset of a filter:** the code expression behind it and behind the default, as written. A label ("Last 30 days", "This year") says nothing exact.
- **A widget on several pages** (a KPI strip in a shared layout or partial): one `W<n>`, with every page that shows it.
- **A record's page:** a widget showing one record's figures (a product's sales on `/products/{id}`) takes the record from the route. Record the route parameter as a filter `F<n>`, its control "opening the record's page", its values the records that page opens.

## Data sources

Phase 2 finds each database in Metabase by its tables, so no host, port or database name is needed. Record per database the analytics read:

- **The engine**, as a hint, under Metabase's name for it (`postgres`, `mysql`, `sqlserver`, `sqlite`): from the manifests (`pg`, `mysql2`, `psycopg2`, `mysqlclient`, `pdo_pgsql`), the datasource's `provider` in a Prisma schema (`postgresql` is `postgres`), or the SQL dialect of the queries (`date_trunc`, `ILIKE` and `::` casts are Postgres; backtick quoting and `DATE_FORMAT` are MySQL). Unknown when none of them says.
- **The tables** the widgets read from it, by the names the database uses, with their schema where the code names one. An ORM's model name isn't a table name: follow its mapping (Prisma's `@@map`, Django's `db_table`, `@Table(name = …)`).

An app with more than one database names the one each query runs on in code (a named connection, a second client): group the tables by those names. Write no password, token or key.

## Schema

From migrations, model or entity classes, or a schema file: each table the analytics read, its columns with types, foreign keys, enum and status values the code compares against, and which columns are nullable. A status value used in code but absent from the schema's enum is a finding.

## The inventory

`inventory.md`, in this order:

- **Stack** — one paragraph, and the source's commit (`git -C <source> rev-parse HEAD`), which every citation is read at. When `git -C <source> status --porcelain` lists a file a widget's chain reads, ask which to read, the commit or the working tree, and cite that.
- **Look** — the app's palette, and the colours each widget sets beyond it (a series, a goal line), each with file:line. A colour from a settings file (`tailwind.config.js`) follows _Before you start_'s permission.
- **Pages** — `P<n>`: route, title, which roles can open it, what else the page is for (a list of orders, a product's record), and its widgets.
- **Widgets** — one entry per KPI, chart and table, numbered `W<n>` in page order:
  - page `P<n>`, or every page that shows it; label as shown, kind (KPI / chart / table)
  - shows: the values it displays (a figure, a series and its grain, a table's columns and which rows)
  - data chain: one line per hop, each with file:line
  - tables and columns read, and for each one the source's own code computes, what fills it (_Following the data_, step 6)
  - rules, raw and untagged: every filter, exclusion, join, date column, clock, rounding and constant the chain applies
  - parameters: the filters and inputs it takes
  - scoping: whose rows it shows to whom, and which roles see the widget at all
  - notes: anything odd, such as a second query merged in or a fallback value
- **Records** — on a page that pairs analytics with records, its lists `L<n>` and actions `A<n>` (`records.md`).
- **Filters** — `F<n>`: page, kind (a date range, a list), values offered, its default, the widgets it applies to, _and the widgets on the same page it doesn't apply to_, and whether moving between pages keeps its value.
- **Data sources** — per database: the engine, or unknown, and the tables the widgets read from it; phase 2 adds its Metabase database.
- **Schema** — the tables the widgets read.
- **Not analytics** — each screen the probe passed over, with why (_Where analytics live_).

## History

Run `git log --follow --format='%h %ad %s' -- <file>` on every file that computes a widget. A definition changed after the widget shipped (a tile rewired from one revenue to another) is dated and recorded under the widget: it explains why two widgets disagree, and which reading is the later intent.

## Completeness check

Before leaving phase 1, count what the views render — chart canvases or components, KPI tiles, tables — page by page, including every role's view, and compare with the `W` entries per page, a widget on several pages counted on each, and the lists under _Records_ and _Not analytics_ apart. A difference is a widget missed or a widget counted twice: find it. Say the counts in `inventory.md`.
