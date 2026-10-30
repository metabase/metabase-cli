---
name: data-app-filters
description: Build the filter controls of a Metabase data app — the filter contract, which cards a filter reaches, All by default, options from their own question, a searchable combobox for entities, date presets, `DateRangePopover` and `DateRangeCalendar` with labels from `useDateFormatter`, and a single-date picker. Triggers — "add a filter to the app", "filter the chart by date", "a date range picker", "filter by customer", "a dropdown of categories", "the filter doesn't change the chart", "the date shows the previous day". The query side — runtime clauses and their limits — is in `data-app-data`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [dataApps]
---

# Filter controls in a data app

A filter is an ordinary React control whose state becomes `filter(...)` clauses in a hook's second argument, on a column the question returns (`data-app-data`, _Runtime clauses_). This skill covers the controls; "panel" below means a chart, KPI or table on the page.

## Write the contract first

Before any control, write one row per filter: the question that gives its options, the raw value `filter(...)` receives, the panels whose question returns that column, and the panels whose question doesn't.

| Filter    | Options question           | Raw value    | Panels                 | Not these      |
| --------- | -------------------------- | ------------ | ---------------------- | -------------- |
| Franchise | franchises, by id and name | franchise id | orders, revenue, stock | —              |
| Plan      | orders broken out by plan  | plan text    | orders                 | revenue, stock |

- A filter in the page's global bar changes every panel that can take it. One that can't reach a panel is scoped to its section, visibly, or left out. A KPI and its detail table about the same thing take the same filters, unless the UI says why not.
- A KPI on an aggregated question shows one complete bucket (`data-app-data`, _Runtime clauses_): it gets its own control of one-bucket presets starting at the last complete bucket, never All time, rather than a shared bar's ranges.
- One date control per scope. Never a global date range beside a page-specific date where one of the two does nothing; a page whose cards use another date column gets one control for that column.
- Build each panel's clauses from its own question's columns, inline at its hook call. Never reuse an array built for another question.

## Values and options

- Every filter starts at **All**, except a KPI's own date control (above). Keep it as `"all"` in state and send it as no clause (`[]`), except on an aggregated question whose panel doesn't show the filtered column, where All is its own question (`data-app-data`, _Runtime clauses_); treat `""`, `null` and `undefined` the same way. In a Yes/No/All filter, Yes and No each filter (`true`, `false`), and only All sends nothing.
- Options come at runtime from their own question (`data-app-data`), broken out on the filtered column — never hardcoded unless the user gave a closed list. Dedupe them from its rows, and keep the label apart from the value.
- Filter by a stable raw value (an id) and show its label; never filter by a display label when an id exists, and never feed free text into an exact-id filter.
- All stays selectable while options load, come back empty or fail; don't disable the control. When fresh options no longer hold the selected value, reset to All:

```tsx
useEffect(() => {
  if (selected !== "all" && !options.some((option) => option.value === selected)) {
    setSelected("all");
  }
}, [options, selected]);
```

## Entities: a searchable combobox

Any filter control whose options come from a question — an id shown as a name, a category, anything that can grow — is one searchable combobox, even while it's short. Picking a row in a list the page already shows (a customer table driving that customer's details) is not a filter control: the row click is the picker. A `<select>` is only for a short closed list the user gave. Prefer the app's component library or a small established combobox package; hand-roll only a small one. Either way:

- Click or focus opens the list at once, before any typing; search matches labels, not ids.
- All is always an option, and picking an option stores its raw value.
- The list is capped or scrolls, and looks like the app's other controls.
- Don't close the list from the trigger's `onBlur` when the popover holds an auto-focused input — moving focus into it closes the list at once. Close on selection, Escape, or focus leaving the whole wrapper.

## Date ranges

A preset bar lists the durations, then All time, then Custom last — leave Custom out only if the user asked for fixed presets, or the bar filters an aggregated question, which offers only whole, complete buckets and no All time on a KPI (`data-app-data`, _Runtime clauses_). Every option ends in the same `[start, end]` range (All time is `[null, null]`), so one `between` filter serves them all. Custom is `DateRangePopover` around your own trigger, or `DateRangeCalendar` inline, both from `@metabase/embedding-sdk-react/data-app`. No date-picker library and no `<input type="date">` for a range.

```tsx
import { DateRangePopover, filter, useDateFormatter } from "@metabase/embedding-sdk-react/data-app";

const { formatDateRange } = useDateFormatter();
const [range, setRange] = useState<[string | null, string | null]>([null, null]);
const [start, end] = range;
// at the hook: filters: start && end ? [filter({ type: "column", name: "CREATED_AT" }, "between", [start, end])] : []

<DateRangePopover value={range} onChange={setRange}>
  <button className="filter-button">{formatDateRange(range) || "Custom"}</button>
</DateRangePopover>;
```

- Both ends are `YYYY-MM-DD` strings, the shape `filter(...)` takes. `onChange` fires on every click, so a half-picked range arrives as `[start, null]`: filter only once both ends are set, never with a sentinel date.
- The child is the trigger: one element or a `forwardRef` component, since the popover attaches a ref and a click handler.
- Label it with `formatDateRange(range)` (or `formatDate` for one end), which formats in the instance's locale; both take a dayjs `format`, and `formatDateRange` a `separator`. It returns `""` until the SDK loads. Never `new Date("YYYY-MM-DD")`: a date-only string parses as UTC and shows the previous day west of Greenwich.
- The popover closes once both ends are picked (`closeOnSelect`); `opened` and `onOpenedChange` control it yourself. Also `defaultValue`, `minDate` and `maxDate` (`YYYY-MM-DD`), `numberOfColumns` (default 2) and `position` (default `bottom-start`). `DateRangeCalendar` takes the same value props plus `className` and `style`.

A preset's range, from local dates — never `toISOString()`, which shifts the day. `lastMonths` is a rolling window, for a rows question; on a month question, `lastCompleteMonths` gives bucket starts:

```ts
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lastMonths = (n: number): [string, string] => {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - n, end.getDate());
  return [ymd(start), ymd(end)];
};
const lastCompleteMonths = (n: number): [string, string] => {
  const now = new Date();
  return [
    ymd(new Date(now.getFullYear(), now.getMonth() - n, 1)),
    ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
  ];
};
```

**A single date or a date-time** is the one case for a library: `npm install react-datepicker`, import `react-datepicker/dist/react-datepicker.css`, type the callback (`(date: Date | null) => …`), and convert with `ymd` above. Pass `null`, never `new Date("")`, for an empty value.

## Check

For every visible filter except a KPI's own date control: All runs the unfiltered question, or its All question; its options come from a question; each option changes every panel the contract says it reaches, and no other; a preset bar ends with Custom unless it filters an aggregated question; and no scope has two date controls. Search the filter controls for `<select` and `type="date"` — an action form keeps its date inputs. Then release the app (`data-app`, _Release_).
