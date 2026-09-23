import type { ActionOutcome } from "../../contracts/changes";
import { assertNever } from "../../contracts/assert-never";
import type { ConnectionState } from "../../contracts/connection";
import {
  worktreeUrl,
  type ContentItem,
  type ContentValidation,
  type EntityKind,
  type MetabaseEdit,
  type MetabaseWorktree,
  type RemoteSyncState,
  type SyncReadiness,
  type SyncTaskSummary,
  type SyncedCollection,
  type SyncedItem,
  type TransformRunOutcome,
  type TransformRunSummary,
  type TransformTestsOutcome,
} from "../../contracts/metabase";
import type { SessionSnapshot, TimelineItem } from "../../contracts/session";
import type { ConnectedFeatures, ServerSummary } from "../../contracts/settings";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const PERCENT = 100;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const TRAILING_SLASHES = /\/+$/u;
const PATH_SEPARATOR = "/";
const FILE_ROOT_POINTER = "/";
const EDITS_NAMED = 3;
const CONTENT_ROWS_SHOWN = 20;

// While an import runs, the panel reads Metabase again this often to move its progress.
export const RUNNING_TASK_POLL_MS = 2000;

const TRANSFORMS_OFF = "Transforms aren't enabled on this instance.";
export const TRANSFORM_TESTS_OFF = "Transform tests aren't enabled on this instance.";
const SIGN_IN_TO_RUN = "Sign in to Metabase again to run it.";
const MAIN_METABASE_ONLY = "Transforms run only in the main Metabase.";

type SyncItem = Extract<TimelineItem, { kind: "sync" }>;

const EDITION_NAMES: Readonly<Record<NonNullable<ServerSummary["edition"]>, string>> = {
  oss: "Open Source",
  ee: "Enterprise",
};

const KIND_LABELS: Readonly<Record<EntityKind, string>> = {
  action: "Action",
  channel: "Channel",
  collection: "Collection",
  dashboard: "Dashboard",
  database: "Database",
  document: "Document",
  field: "Field",
  glossary: "Glossary",
  measure: "Measure",
  metabot: "Metabot",
  metric: "Metric",
  model: "Model",
  "python-library": "Python library",
  question: "Question",
  segment: "Segment",
  snippet: "Snippet",
  table: "Table",
  timeline: "Timeline",
  transform: "Transform",
  "transform-job": "Transform job",
  "transform-tag": "Transform tag",
};

const CHANGE_LABELS: Readonly<Record<ContentItem["change"], string>> = {
  added: "new",
  modified: "edited",
  deleted: "deleted",
  renamed: "moved",
};

const TASK_KIND_LABELS: Readonly<Record<SyncTaskSummary["kind"], string>> = {
  import: "import",
  export: "export",
};

const RUNNING_TASK_LABELS: Readonly<Record<SyncTaskSummary["kind"], string>> = {
  import: "Importing",
  export: "Exporting",
};

const ENDED_TASK_PHRASES: Readonly<Record<Exclude<SyncTaskSummary["status"], "running">, string>> =
  {
    successful: "succeeded",
    errored: "errored",
    "timed-out": "timed out",
    conflict: "hit conflicts",
    cancelled: "was cancelled",
  };

export type LineTone = "plain" | "quiet" | "ok" | "warning" | "error";

const ENDED_TASK_TONES: Readonly<Record<Exclude<SyncTaskSummary["status"], "running">, LineTone>> =
  {
    successful: "ok",
    errored: "error",
    "timed-out": "error",
    conflict: "error",
    cancelled: "quiet",
  };

const RUN_PHRASES: Readonly<Record<TransformRunSummary["status"], string>> = {
  started: "is running",
  succeeded: "succeeded",
  failed: "failed",
  timeout: "timed out",
  canceled: "was cancelled",
  canceling: "is being cancelled",
};

const RUN_TONES: Readonly<Record<TransformRunSummary["status"], LineTone>> = {
  started: "quiet",
  succeeded: "ok",
  failed: "error",
  timeout: "error",
  canceled: "quiet",
  canceling: "quiet",
};

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

export function age(from: string, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - Date.parse(from));
  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return `${plural(Math.floor(elapsed / MINUTE_MS), "minute")} ago`;
  }
  if (elapsed < DAY_MS) {
    return `${plural(Math.floor(elapsed / HOUR_MS), "hour")} ago`;
  }
  return `${plural(Math.floor(elapsed / DAY_MS), "day")} ago`;
}

// What the head names: the instance by its host, which Metabase it runs, and in smaller type who
// the app is signed in as. `version` and `user` are null when the connection cannot say. `url`
// opens the session's worktree when it has one.
export interface InstanceHead {
  readonly host: string;
  readonly url: string;
  readonly version: string | null;
  readonly user: string | null;
}

export function hostOf(url: string): string {
  return url.replace(SCHEME, "").replace(TRAILING_SLASHES, "");
}

function versionOf(server: ServerSummary): string | null {
  const parts = [
    server.edition === null ? null : EDITION_NAMES[server.edition],
    server.version,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" ");
}

export function instanceHead(
  url: string,
  server: ServerSummary | null,
  user: string | null,
  worktree: MetabaseWorktree,
): InstanceHead {
  const version = server === null ? null : versionOf(server);
  return { host: hostOf(url), url: worktreeUrl(url, worktree), version, user };
}

export function featuresOf(connection: ConnectionState): ConnectedFeatures | null {
  return connection.kind === "connected" || connection.kind === "stale"
    ? connection.server.features
    : null;
}

interface TrackedLine {
  readonly lead: string;
  readonly branch: string | null;
  readonly collections: string | null;
}

export interface EditsLine {
  readonly text: string;
  readonly names: readonly string[];
  readonly more: number;
}

interface PlainLine {
  readonly text: string;
  readonly tone: LineTone;
}

interface LastRunLine extends PlainLine {
  readonly status: TransformRunSummary["status"];
}

interface RunningTask {
  readonly kind: "running";
  readonly label: string;
  readonly percent: number | null;
}

// `detail` is what the server said of the task, null when it said nothing.
interface EndedTask {
  readonly kind: "ended";
  readonly status: SyncTaskSummary["status"];
  readonly text: string;
  readonly detail: string | null;
  readonly tone: LineTone;
}

export type TaskView = RunningTask | EndedTask;

// What the branch section says Metabase holds: the branch it is synced to, what was edited there
// and not in git, whether the remote moved past it, and its running or last task.
export interface BranchView {
  readonly tracked: TrackedLine;
  readonly edits: EditsLine | null;
  readonly remote: PlainLine | null;
  readonly task: TaskView | null;
}

function editName(edit: MetabaseEdit): string {
  return edit.name ?? `${edit.model} ${edit.id}`;
}

// What agrees with git says nothing; only a difference earns a line.
function editsLine(edits: readonly MetabaseEdit[]): EditsLine | null {
  if (edits.length === 0) {
    return null;
  }
  const named = edits.slice(0, EDITS_NAMED).map(editName);
  const text = `${plural(edits.length, "edit")} made in Metabase ${edits.length === 1 ? "isn't" : "aren't"} in git yet:`;
  return { text, names: named, more: edits.length - named.length };
}

export function taskView(task: SyncTaskSummary | null, now: Date): TaskView | null {
  if (task === null) {
    return null;
  }
  if (task.status === "running") {
    const percent = task.progress === null ? null : Math.round(task.progress * PERCENT);
    return { kind: "running", label: RUNNING_TASK_LABELS[task.kind], percent };
  }
  const when = task.endedAt === null ? "" : ` ${age(task.endedAt, now)}`;
  return {
    kind: "ended",
    status: task.status,
    text: `Last ${TASK_KIND_LABELS[task.kind]} ${ENDED_TASK_PHRASES[task.status]}${when}`,
    detail: task.message,
    tone: ENDED_TASK_TONES[task.status],
  };
}

function remoteLine(changed: boolean): PlainLine | null {
  if (!changed) {
    return null;
  }
  return { text: "The remote branch has changes Metabase hasn't imported.", tone: "warning" };
}

export function branchView(state: RemoteSyncState, now: Date): BranchView | null {
  if (state.kind !== "read") {
    return null;
  }
  const collections =
    state.collectionCount === 0 ? null : plural(state.collectionCount, "collection");
  const tracked: TrackedLine =
    state.branch === null
      ? { lead: "Metabase isn't synced to a branch yet.", branch: null, collections: null }
      : { lead: "Metabase is synced to", branch: state.branch, collections };
  return {
    tracked,
    edits: editsLine(state.edits),
    remote: remoteLine(state.remoteChanges),
    task: taskView(state.task, now),
  };
}

function taskRunning(state: RemoteSyncState | null): boolean {
  return state !== null && state.kind === "read" && state.task?.status === "running";
}

export interface SyncButton {
  readonly label: string;
  readonly disabled: boolean;
}

// A sync waits while this window syncs and while Metabase runs a task of its own, whoever started
// it.
export function syncButton(
  readiness: SyncReadiness,
  syncing: boolean,
  state: RemoteSyncState | null,
): SyncButton {
  if (syncing) {
    return { label: "Syncing", disabled: true };
  }
  const label = readiness.kind === "ready" && readiness.push ? "Push and sync" : "Sync to Metabase";
  return { label, disabled: readiness.kind === "blocked" || taskRunning(state) };
}

// The panel reads Metabase again while a task runs, whether this window started it or not.
export function pollsMetabase(syncing: boolean, state: RemoteSyncState | null): boolean {
  return syncing || taskRunning(state);
}

export function lastSync(snapshot: SessionSnapshot): SyncItem | null {
  for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
    const item = snapshot.items[index];
    if (item !== undefined && item.kind === "sync") {
      return item;
    }
  }
  return null;
}

export function syncCount(snapshot: SessionSnapshot): number {
  return snapshot.items.filter((item) => item.kind === "sync").length;
}

// A failed import is already the last sync the panel shows, so only a refusal that recorded nothing
// is repeated beside the button.
export function syncRefusal(
  outcome: ActionOutcome | null,
  previous: SyncItem | null,
): string | null {
  if (outcome === null || outcome.kind === "done") {
    return null;
  }
  const recorded = previous === null ? null : previous.outcome;
  if (recorded !== null && recorded.kind === "failed" && recorded.message === outcome.message) {
    return null;
  }
  return outcome.message;
}

interface ActionEnabled {
  readonly kind: "enabled";
}

interface ActionRunning {
  readonly kind: "running";
}

interface ActionDisabled {
  readonly kind: "disabled";
  readonly reason: string;
}

export type ActionView = ActionEnabled | ActionRunning | ActionDisabled;

interface Idle {
  readonly kind: "idle";
}

interface Running {
  readonly kind: "running";
}

interface Answered<Outcome> {
  readonly kind: "answered";
  readonly outcome: Outcome;
}

type Asked<Outcome> = Idle | Running | Answered<Outcome>;

// What this window last asked of a transform: nothing, a run or its tests in flight, or what came
// back.
export interface TransformActivity {
  readonly run: Asked<TransformRunOutcome>;
  readonly tests: Asked<TransformTestsOutcome>;
}

export const IDLE_ACTIVITY: TransformActivity = { run: { kind: "idle" }, tests: { kind: "idle" } };

interface TransformView {
  readonly id: number;
  readonly run: ActionView;
  readonly tests: ActionView;
  readonly lastRun: LastRunLine | null;
  readonly runRefusal: string | null;
  readonly testsLine: PlainLine | null;
}

export interface ValidationView {
  readonly kind: ContentValidation["kind"];
  readonly lines: readonly string[];
}

export interface ContentRow {
  readonly path: string;
  readonly fileName: string;
  readonly kind: string;
  readonly name: string;
  readonly change: string;
  readonly validation: ValidationView | null;
  readonly url: string | null;
  readonly transform: TransformView | null;
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf(PATH_SEPARATOR) + 1);
}

function validationView(validation: ContentValidation): ValidationView {
  switch (validation.kind) {
    case "valid": {
      return { kind: "valid", lines: [] };
    }
    case "invalid": {
      const lines = validation.issues.map((issue) =>
        issue.pointer === FILE_ROOT_POINTER ? issue.message : `${issue.pointer}: ${issue.message}`,
      );
      return { kind: "invalid", lines };
    }
    case "unchecked": {
      return { kind: "unchecked", lines: [`Not validated: ${validation.reason}`] };
    }
    default: {
      return assertNever(validation);
    }
  }
}

// Where a transform could run: what the instance offers, and the worktree the session is in, which
// runs none.
interface TransformReach {
  readonly features: ConnectedFeatures | null;
  readonly worktree: MetabaseWorktree;
}

// A missing feature is the reason the action is off, named where the action is.
function actionView<Outcome>(
  reach: TransformReach,
  feature: keyof ConnectedFeatures,
  off: string,
  asked: Asked<Outcome>,
): ActionView {
  if (reach.features === null) {
    return { kind: "disabled", reason: SIGN_IN_TO_RUN };
  }
  if (!reach.features[feature]) {
    return { kind: "disabled", reason: off };
  }
  if (reach.worktree.kind === "ready") {
    return { kind: "disabled", reason: MAIN_METABASE_ONLY };
  }
  return asked.kind === "running" ? { kind: "running" } : { kind: "enabled" };
}

// The branch the session works on and, as metadata beside it, the worktree Metabase keeps for it.
export interface SessionBranch {
  readonly label: string;
  readonly worktree: string | null;
}

const NO_BRANCH = "No branch yet";

export function sessionBranch(
  worktree: MetabaseWorktree,
  readiness: SyncReadiness,
  checkoutBranch: string | null,
): SessionBranch {
  if (worktree.kind === "ready") {
    return { label: worktree.branch, worktree: `worktree ${worktree.id}` };
  }
  const branch = readiness.kind === "ready" ? readiness.branch : checkoutBranch;
  return { label: branch ?? NO_BRANCH, worktree: null };
}

// A session whose worktree could not be made works in the main Metabase, and says why.
export function worktreeNote(worktree: MetabaseWorktree): string | null {
  return worktree.kind === "failed" ? `Working in the main Metabase: ${worktree.message}` : null;
}

function lastRunLine(run: TransformRunSummary, now: Date): LastRunLine {
  const phrase = `Last run ${RUN_PHRASES[run.status]} ${age(run.at, now)}.`;
  return {
    status: run.status,
    text: run.message === null ? phrase : `${phrase} ${run.message}`,
    tone: RUN_TONES[run.status],
  };
}

export function testsLine(outcome: TransformTestsOutcome): PlainLine {
  if (outcome.kind === "refused") {
    return { text: outcome.message, tone: "error" };
  }
  if (outcome.tests.length === 0) {
    return { text: "This transform has no tests yet.", tone: "quiet" };
  }
  const failed = outcome.tests.filter((test) => test.status === "failed");
  if (failed.length === 0) {
    return { text: `${plural(outcome.tests.length, "test")} passed.`, tone: "ok" };
  }
  const named = failed.map((test) =>
    test.failing.length === 0 ? test.name : `${test.name} (${test.failing.join(", ")})`,
  );
  return {
    text: `${failed.length} of ${plural(outcome.tests.length, "test")} failed: ${named.join("; ")}.`,
    tone: "error",
  };
}

function transformView(
  item: ContentItem,
  reach: TransformReach,
  activity: TransformActivity,
  now: Date,
): TransformView | null {
  const transform = item.transform;
  if (transform === null) {
    return null;
  }
  const ran = activity.run.kind === "answered" ? activity.run.outcome : null;
  const lastRun = ran?.kind === "ran" ? ran.run : transform.lastRun;
  return {
    id: transform.id,
    run: actionView(reach, "transforms", TRANSFORMS_OFF, activity.run),
    tests: actionView(reach, "transformTests", TRANSFORM_TESTS_OFF, activity.tests),
    lastRun: lastRun === null ? null : lastRunLine(lastRun, now),
    runRefusal: ran?.kind === "refused" ? ran.message : null,
    testsLine: activity.tests.kind === "answered" ? testsLine(activity.tests.outcome) : null,
  };
}

// One row per changed content file, in the checkout's path order.
export function contentRows(
  items: readonly ContentItem[],
  reach: TransformReach,
  activity: (transformId: number) => TransformActivity,
  now: Date,
): ContentRow[] {
  return items.map((item) => {
    const fileName = fileNameOf(item.path);
    return {
      path: item.path,
      fileName,
      kind: item.entity === null ? "File" : KIND_LABELS[item.entity.kind],
      name: item.entity === null ? fileName : item.entity.name,
      change: CHANGE_LABELS[item.change],
      validation: item.validation === null ? null : validationView(item.validation),
      url: item.url,
      transform:
        item.transform === null
          ? null
          : transformView(item, reach, activity(item.transform.id), now),
    };
  });
}

// What the content list shows: at most `CONTENT_ROWS_SHOWN` rows matching the filter, invalid files
// first, and how many more match. The filter is offered only once the rows outgrow the cap.
export interface ContentWindow {
  readonly rows: readonly ContentRow[];
  readonly more: number;
  readonly filterable: boolean;
}

function matches(row: ContentRow, needle: string): boolean {
  return row.name.toLowerCase().includes(needle) || row.path.toLowerCase().includes(needle);
}

export function contentWindow(rows: readonly ContentRow[], filter: string): ContentWindow {
  const needle = filter.trim().toLowerCase();
  const matching = needle.length === 0 ? rows : rows.filter((row) => matches(row, needle));
  const invalid = matching.filter((row) => row.validation?.kind === "invalid");
  const rest = matching.filter((row) => row.validation?.kind !== "invalid");
  const shown = [...invalid, ...rest].slice(0, CONTENT_ROWS_SHOWN);
  return {
    rows: shown,
    more: matching.length - shown.length,
    filterable: rows.length > CONTENT_ROWS_SHOWN,
  };
}

// A name is one segment of a tree path, so a slash in it is drawn as a lookalike that is not one.
const NAME_SLASH = /\//gu;
const SEGMENT_SLASH = "∕";
const COLLECTION_QUALIFIER = "collection";

// The synced content as `FileTree` takes it: a path per collection and item, built from the names
// Metabase shows, and for each item's path the checkout file it opens, null when the branch holds
// none.
export interface SyncedTreeView {
  readonly paths: readonly string[];
  readonly files: ReadonlyMap<string, string | null>;
}

interface FolderEntry {
  readonly kind: "folder";
  readonly collection: SyncedCollection;
}

interface LeafEntry {
  readonly kind: "leaf";
  readonly item: SyncedItem;
}

type TreeEntry = FolderEntry | LeafEntry;

interface Sibling {
  readonly name: string;
  readonly qualifier: string;
  readonly id: number;
}

interface LabelChoices {
  readonly plain: string;
  readonly qualified: string;
  readonly numbered: string;
}

interface LabelledEntry {
  readonly label: string;
  readonly entry: TreeEntry;
}

function siblingOf(entry: TreeEntry): Sibling {
  switch (entry.kind) {
    case "folder": {
      const collection = entry.collection;
      return { name: collection.name, qualifier: COLLECTION_QUALIFIER, id: collection.id };
    }
    case "leaf": {
      return { name: entry.item.name, qualifier: entry.item.model, id: entry.item.id };
    }
    default: {
      return assertNever(entry);
    }
  }
}

function choicesOf(sibling: Sibling): LabelChoices {
  const plain = sibling.name.replace(NAME_SLASH, SEGMENT_SLASH);
  return {
    plain,
    qualified: `${plain} (${sibling.qualifier})`,
    numbered: `${plain} (${sibling.qualifier} ${sibling.id})`,
  };
}

function tally(labels: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

function bySibling(left: TreeEntry, right: TreeEntry): number {
  const a = siblingOf(left);
  const b = siblingOf(right);
  return a.name.localeCompare(b.name) || a.qualifier.localeCompare(b.qualifier) || a.id - b.id;
}

// Siblings share one folder, a collection's sub-collections beside its items. A name two of them
// share takes the model, and a name and model two of them share take the id as well. A label that
// still lands on one already given takes the id again until it is free.
function labelSiblings(entries: readonly TreeEntry[]): LabelledEntry[] {
  const sorted = entries.toSorted(bySibling);
  const choices = sorted.map((entry) => choicesOf(siblingOf(entry)));
  const plainCounts = tally(choices.map((choice) => choice.plain));
  const qualifiedCounts = tally(choices.map((choice) => choice.qualified));
  const taken = new Set<string>();
  return sorted.map((entry) => {
    const choice = choicesOf(siblingOf(entry));
    let label = choice.numbered;
    if (plainCounts.get(choice.plain) === 1) {
      label = choice.plain;
    } else if (qualifiedCounts.get(choice.qualified) === 1) {
      label = choice.qualified;
    }
    while (taken.has(label)) {
      label = `${label} ${siblingOf(entry).id}`;
    }
    taken.add(label);
    return { label, entry };
  });
}

function entriesOf(collection: SyncedCollection): TreeEntry[] {
  return [
    ...collection.collections.map((child): TreeEntry => ({ kind: "folder", collection: child })),
    ...collection.items.map((item): TreeEntry => ({ kind: "leaf", item })),
  ];
}

const LINE_BREAK = /\r?\n/u;

// A read that failed says so plainly; the first line of what the CLI said sits under it and the
// whole of it shows on hover.
export interface ProblemView {
  readonly label: string;
  readonly summary: string;
  readonly detail: string;
}

function problemView(label: string, message: string): ProblemView {
  const first = message
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return { label, summary: first ?? message, detail: message };
}

export function treeProblem(message: string): ProblemView {
  return problemView("Couldn't read synced content", message);
}

export function panelProblem(message: string): ProblemView {
  return problemView("Couldn't read Metabase", message);
}

// How many items the tree holds, or nothing to say when it holds none.
export function syncedItemsLine(view: SyncedTreeView): string | null {
  return view.files.size === 0 ? null : plural(view.files.size, "item");
}

// Every collection is a folder of its own, so one that holds nothing still shows.
export function syncedTreeView(collections: readonly SyncedCollection[]): SyncedTreeView {
  const paths: string[] = [];
  const files = new Map<string, string | null>();
  const walk = (prefix: string, entries: readonly TreeEntry[]): void => {
    for (const { label, entry } of labelSiblings(entries)) {
      if (entry.kind === "folder") {
        const folder = `${prefix}${label}${PATH_SEPARATOR}`;
        paths.push(folder);
        walk(folder, entriesOf(entry.collection));
      } else {
        const path = `${prefix}${label}`;
        paths.push(path);
        files.set(path, entry.item.path);
      }
    }
  };
  walk(
    "",
    collections.map((collection): TreeEntry => ({ kind: "folder", collection })),
  );
  return { paths, files };
}
