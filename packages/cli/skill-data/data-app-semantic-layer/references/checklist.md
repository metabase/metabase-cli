# Final checks and common mistakes

## Final Checks

- Run `npm run typecheck`. `Property 'definedWithDefineQuery' is missing` or `Property 'definedWithDefineAction' is missing` means a hook received something other than a `queries/` or `actions/` export; move the object there and import it.
- Search touched files for `useMetabaseQuery(`, `useMetabaseQueryObject(`, and `useAction(`. The first argument must be an identifier imported from `queries/` or `actions/`; a `{`, a `defineQuery(`, a `defineAction(`, or a spread there is wrong even when it compiles. The second argument of the query hooks is the dynamic object and is written inline.
- Confirm `queries/` and `actions/` sit beside `package.json`, not under `src/`, and that every definition the app renders lives there.
- Run `npm run build`; it synchronizes queries before producing the bundle.
- Keep TypeScript diagnostics compact in the chat or handoff. Use the full output locally to fix the app, but report grouped root causes and only a few representative diagnostics instead of pasting the entire `tsc` output.
- Verify every rendered value can be traced to a returned row property, schema field, measure, or deterministic transform.
- Search touched files for `row[0]`, `row[1]`, `row.orderedAt`, `row.orderDate`, `as unknown as`, `DisplayRow`, `<select`, `margin`, `rate`, `score`, `percent`, `%`, `* 100`, and `.toFixed`; fix positional rows, result-key guesses, entity `<select>` filters, and unsupported business-field interpretations.
- Verify every date preset bar includes Custom last unless explicitly omitted, every visible date filter affects the current page, and no page shows duplicate date filters for one scope.
- Verify `data_app.yaml` points at the built bundle path and that the bundle path is tracked by git.
- For every visible filter, verify "All" maps to no filter, selected values come from runtime query results, and each non-All option changes every card it claims to affect.

## Common Mistakes

- Creating or searching for Metabase content during app building.
- Writing the query object at the hook call instead of exporting it from `queries/` with `defineQuery`, or the action at `useAction` instead of from `actions/` with `defineAction`. Both are compile errors now; the fix is the directory, not a cast.
- Wrapping the inline object in `defineQuery(...)` or `defineAction(...)` at the call site. It compiles, but `sync-resources` never sees it, so it is refused in production.
- Putting definitions under `src/queries/` or `src/actions/`, where `sync-resources` never looks.
- Importing older hooks instead of `useMetabaseQuery`.
- Copying raw numeric IDs into constants instead of using generated schema objects.
- Inventing ad hoc measure objects such as `{ name: "count" }` or `{ name: "sum", field: fieldId }`.
- Passing raw strings for table fields.
- Adding lookup helpers instead of using keyed generated schema objects.
- Inventing SDK component prop names instead of using `query` for generated table queries.
- Mixing fields, segments, or measures from unrelated tables.
- Passing a segment or measure to the dynamic second argument, where only result columns resolve.
- Adding a filter UI that sends empty values instead of omitting the filter.
- Hardcoding categorical filter values instead of querying the runtime values from Metabase.
- Displaying entity names but filtering by those names when a stable ID is available.
- Applying a dashboard-level filter to only one KPI while related charts and tables ignore it.
- Showing a global Date Range plus a page-specific Snapshot Date where one date filter has no effect.
- Letting a KPI and its detail table use different date or category filters without explaining the difference.
- Rendering `Margin`/`Rate`/`Score`/`Health` with invented `%`, stars, colors, or thresholds.
- Shipping a date preset bar with no Custom range option, or Custom before All time.
- Charting opaque IDs such as `franchise_id` when a user-facing name is available.
- Rendering an entity filter in a plain `<select>`, even if the current runtime option list is short.
- Reaching for native `<input type="date">` or any date picker dependency (`react-datepicker`, `react-day-picker`, a UI suite's picker) for a date range instead of `DateRangePopover`, and shipping browser-controlled `mm/dd/yyyy` placeholders or unthemed calendar popovers.
- Labelling a date trigger with `new Date("YYYY-MM-DD").toLocaleDateString()` instead of `useDateFormatter()`, so the label is a day early for users west of Greenwich.
- Assuming `filter(...)` fully validates value types.
- Letting a `null` bucket become the latest time-series point.
- Hardcoding business values, labels, timestamps, or rankings.
- Creating chart-ready arrays by hand instead of deriving them from queried `data.rows`.
- Casting typed SDK rows to generic tuple rows such as `[string, number]`.
- Reading generated object property names such as `row.orderedAt` when Metabase returns column names such as `ordered_at`.
- Rendering fields that are not present in the schema or returned query result.
- Rendering `No data` while the SDK is still authenticating or loading.
- Creating nested `MetabaseProvider` instances instead of sharing one provider at the app boundary.
