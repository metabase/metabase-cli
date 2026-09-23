import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "playwright";

import { OpenedExternally } from "../../src/contracts/changes";
import { SettingsView } from "../../src/contracts/settings";
import { SessionIndex, SessionSnapshot, type SessionIndexEntry } from "../../src/contracts/session";
import { DriverFailure, closeApp, timestamp } from "../app";
import {
  chooseOption,
  TURN_TIMEOUT_MS,
  WORKTREE_OPTION,
  chooseTheme,
  closeSettings,
  expectVisible,
  git,
  openSettings,
  openWindow,
  pointAtWorktreeRoot,
  seedRepository,
  sendFollowUp,
  start,
  startSession,
  stopEverySession,
  temporaryDir,
  type Note,
  type Scenario,
  shoot,
} from "../scenario";

const UNIT = "u6";

const ORDERS_SQL = "-- draft\nselect id, status, total\nfrom orders\nwhere status <> 'test'\n";
const CUSTOMERS_SQL = "-- draft\nselect id, name\nfrom customers\n";
const ORDERS_YAML = "name: orders\ndescription: draft\ncolumns:\n  - id\n  - total\n";
const NOTES_MD = "# Notes\n\nScratch notes for the orders work.\n";

const EDIT_PROMPT =
  "Make exactly these three edits and nothing else, then stop: in transforms/orders.sql change the first line to `-- cleaned orders`; in transforms/customers.sql change the first line to `-- cleaned customers`; in models/orders.yaml change `description: draft` to `description: cleaned`.";
const DELETE_PROMPT = "Delete the file notes.md with rm, change nothing else, and stop.";
const WRITE_PROMPT =
  "Create a file named segments/big_orders.yaml containing `name: big_orders` and stop.";

const EDITED_FILES = ["models/orders.yaml", "transforms/customers.sql", "transforms/orders.sql"];
const DELETED_FILE = "notes.md";
const REVERTED_FILE = "transforms/orders.sql";
const OPENED_FILE = "transforms/customers.sql";

const ALL_PERMISSIONS = "Skip every check";
const EDITOR_COMMAND = "code --reuse-window";
const PULL_REQUEST_REMOTE = "https://github.com/metabase/rde-demo.git";

const SETTLE_MS = 600;

// The box is Linux, where the app's Cmd bindings take Ctrl.
export const COLLAPSE_CHORD = "Control+Shift+D";

const REVIEW_LIGHT = "u6-review-light.png";
const REVIEW_DARK = "u6-review-dark.png";

async function seedContent(repositoryPath: string): Promise<void> {
  await mkdir(join(repositoryPath, "transforms"), { recursive: true });
  await mkdir(join(repositoryPath, "models"), { recursive: true });
  await writeFile(join(repositoryPath, "transforms", "orders.sql"), ORDERS_SQL, "utf8");
  await writeFile(join(repositoryPath, "transforms", "customers.sql"), CUSTOMERS_SQL, "utf8");
  await writeFile(join(repositoryPath, "models", "orders.yaml"), ORDERS_YAML, "utf8");
  await writeFile(join(repositoryPath, "notes.md"), NOTES_MD, "utf8");
  await git(repositoryPath, "add", ".");
  await git(
    repositoryPath,
    "-c",
    "user.email=rde@example.com",
    "-c",
    "user.name=RDE",
    "commit",
    "-m",
    "content",
  );
}

export const DIFF_OPTIONS = "Diff options";
const SIDE_BY_SIDE = "Side by side";
const WHOLE_FILES = "Whole files";

// The diff's options live in a menu beside the turn switch; each toggle opens it, flips one item and
// closes it again.
export async function toggleDiffOption(window: Page, option: string): Promise<void> {
  await panel(window).getByRole("button", { name: DIFF_OPTIONS, exact: true }).click();
  const menu = window.getByRole("menu");
  await menu.getByRole("menuitemcheckbox", { name: option, exact: true }).click();
  await window.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
}

async function settle(window: Page): Promise<void> {
  await window.waitForTimeout(SETTLE_MS);
}

async function checkpointCount(window: Page): Promise<number> {
  return window.locator('[data-row="checkpoint"]').count();
}

async function awaitCheckpoints(window: Page, count: number): Promise<void> {
  await window
    .locator('[data-row="checkpoint"]')
    .nth(count - 1)
    .waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
}

async function startWithAllPermissions(window: Page, prompt: string): Promise<void> {
  await chooseOption(window, "permission", ALL_PERMISSIONS);
  await startSession(window, prompt, WORKTREE_OPTION);
}

async function newestSession(window: Page): Promise<SessionIndexEntry> {
  const listed: unknown = await window.evaluate("window.rde.sessionsList()");
  const entry = SessionIndex.parse(listed).sessions[0];
  if (entry === undefined) {
    throw new DriverFailure("the app recorded no session");
  }
  return entry;
}

function panel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

// The tree renders in an open shadow root, which Playwright's CSS locators pierce; each row carries
// its whole path.
function treeRow(window: Page, path: string): Locator {
  return panel(window).locator(`[data-item-path="${path}"]`).first();
}

async function requireTreeFile(window: Page, path: string): Promise<void> {
  await treeRow(window, path).waitFor({ state: "visible" });
}

async function requireTreeLacks(window: Page, path: string): Promise<void> {
  await treeRow(window, path).waitFor({ state: "detached" });
}

async function summary(window: Page): Promise<string> {
  const line = panel(window).getByText("changed", { exact: false }).first();
  await line.waitFor({ state: "visible" });
  return line.innerText();
}

// Shiki hands every token its own colour, so a highlighted line carries more than one colour and a
// plain one carries a single colour.
const HIGHLIGHT_SCRIPT = `(() => {
  const colours = new Set();
  const visit = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot !== null) { visit(element.shadowRoot); }
      const text = element.textContent ?? "";
      if (element.children.length === 0 && text.trim().length > 0 && element.closest("[data-line]") !== null) {
        colours.add(getComputedStyle(element).color);
      }
    }
  };
  visit(document);
  return colours.size;
})()`;

async function tokenColours(window: Page): Promise<number> {
  const count: unknown = await window.evaluate(HIGHLIGHT_SCRIPT);
  if (typeof count !== "number") {
    throw new DriverFailure("the page did not report its token colours");
  }
  return count;
}

async function chooseTurn(window: Page, label: string): Promise<void> {
  await panel(window).getByLabel("Turn").selectOption({ label });
}

async function gitLog(dir: string, lines: readonly string[]): Promise<string> {
  const path = join(dir, `${timestamp()}_${UNIT}-git.log`);
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

async function gitSection(cwd: string, ...args: string[]): Promise<string> {
  return `$ git ${args.join(" ")}\n${(await git(cwd, ...args)).trimEnd()}`;
}

async function chooseEditor(window: Page, note: Note): Promise<void> {
  await openSettings(window, note);
  await window.getByRole("button", { name: "Repository", exact: true }).click();
  await window.getByLabel("Editor").fill(EDITOR_COMMAND);
  await window.getByRole("button", { name: "Save editor" }).click();
  await expectVisible(window, "Saved");
  await closeSettings(window);
  const settings = SettingsView.parse(await window.evaluate("window.rde.settingsRead()"));
  if (settings.editor !== EDITOR_COMMAND) {
    throw new DriverFailure(`the editor setting reads ${String(settings.editor)}`);
  }
  await note(`the editor setting holds "${settings.editor}"`);
}

const CHANGES_PANEL: Scenario = {
  name: "changes-panel",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    await seedContent(repositoryPath);
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    await chooseEditor(window, note);
    await startWithAllPermissions(window, EDIT_PROMPT);
    await awaitCheckpoints(window, 1);
    await note("turn 1 captured its checkpoint");
    await sendFollowUp(window, DELETE_PROMPT);
    await awaitCheckpoints(window, 2);
    await note(`turn 2 captured its checkpoint; ${String(await checkpointCount(window))} in all`);

    const session = await newestSession(window);
    const worktree = session.workspace.path;
    await note(`session ${session.id} in ${worktree}`);

    for (const path of [...EDITED_FILES, DELETED_FILE]) {
      await requireTreeFile(window, path);
    }
    const allTurns = await summary(window);
    await note(`all turns: ${allTurns}`);
    if (!allTurns.startsWith("4 files changed")) {
      throw new DriverFailure(`the panel counted "${allTurns}" for three edits and a deletion`);
    }
    await settle(window);
    const colours = await tokenColours(window);
    await note(`the unified diff paints its tokens in ${String(colours)} colours`);
    if (colours < 3) {
      throw new DriverFailure(
        `the diff shows ${String(colours)} colours, so nothing is highlighted`,
      );
    }
    const workers = window.workers().map((worker) => worker.url());
    await note(`the highlighting worker loaded from ${workers.join(", ")}`);
    if (workers.length === 0) {
      throw new DriverFailure("the diff highlighted without its worker pool");
    }
    const unified = await shoot(window, dir, UNIT, "changes-unified");
    await note(`the tree with counts and the unified diff: ${unified}`);

    await toggleDiffOption(window, SIDE_BY_SIDE);
    await settle(window);
    const split = await shoot(window, dir, UNIT, "changes-split");
    await note(`the split diff: ${split}`);
    await toggleDiffOption(window, SIDE_BY_SIDE);

    await chooseTurn(window, "Turn 2");
    await requireTreeFile(window, DELETED_FILE);
    await requireTreeLacks(window, REVERTED_FILE);
    const turnTwo = await summary(window);
    await note(`turn 2 alone: ${turnTwo}`);
    if (!turnTwo.startsWith("1 file changed")) {
      throw new DriverFailure(`turn 2 deleted one file and the panel says "${turnTwo}"`);
    }
    await settle(window);
    const perTurn = await shoot(window, dir, UNIT, "changes-turn-2");
    await note(`the per-turn view for turn 2: ${perTurn}`);

    await chooseTurn(window, "All turns");
    await requireTreeFile(window, REVERTED_FILE);
    await panel(window)
      .getByRole("button", { name: `Revert ${REVERTED_FILE}` })
      .click();
    const confirm = window.getByRole("dialog");
    await settle(window);
    const asked = await confirm.innerText();
    await note(`the revert confirm reads: ${asked.replaceAll("\n", " ")}`);
    if (!asked.includes(`refs/rde/checkpoints/${session.id}/0`)) {
      throw new DriverFailure("the revert confirm does not name the checkpoint it restores to");
    }
    const confirmShot = await shoot(window, dir, UNIT, "changes-revert-confirm");
    await confirm.getByRole("button", { name: "Revert file" }).click();
    await confirm.waitFor({ state: "detached" });
    await requireTreeLacks(window, REVERTED_FILE);
    const restored = await readFile(join(worktree, REVERTED_FILE), "utf8");
    if (restored !== ORDERS_SQL) {
      throw new DriverFailure(`${REVERTED_FILE} reads "${restored}" after the revert`);
    }
    await note(`${REVERTED_FILE} is back to the checkpoint's content; the confirm: ${confirmShot}`);
    await panel(window)
      .getByRole("button", { name: `Open ${OPENED_FILE}` })
      .click();
    const opened = await openedExternally(window, (seen) => seen.paths.length > 0);
    await note(`Open handed main ${opened.paths.join(", ")} for the editor`);
    if (opened.paths[0] !== join(worktree, OPENED_FILE)) {
      throw new DriverFailure("Open did not name the file inside the session's worktree");
    }
    const afterRevert = await summary(window);
    await note(`after the revert: ${afterRevert}`);
    await settle(window);
    const reverted = await shoot(window, dir, UNIT, "changes-reverted");
    await window.screenshot({ path: join(dir, REVIEW_LIGHT) });

    await chooseTheme(window, "Dark");
    await settle(window);
    const dark = await shoot(window, dir, UNIT, "changes-dark");
    await window.screenshot({ path: join(dir, REVIEW_DARK) });
    await note(`the same panel in dark: ${dark}`);

    await panel(window).getByRole("tab", { name: "Metabase", exact: true }).click();
    await panel(window)
      .getByRole("button", { name: "Connect to Metabase", exact: true })
      .waitFor({ state: "visible" });
    const metabaseTab = await shoot(window, dir, UNIT, "changes-metabase-tab");
    await note(`the Metabase tab beside Changes: ${metabaseTab}`);
    await panel(window).getByRole("tab", { name: "Changes", exact: true }).click();

    await window.locator("[data-prompt]").focus();
    await window.keyboard.press(COLLAPSE_CHORD);
    await panel(window).waitFor({ state: "detached" });
    const collapsed = await shoot(window, dir, UNIT, "changes-collapsed");
    await window.keyboard.press(COLLAPSE_CHORD);
    await panel(window).waitFor({ state: "visible" });
    await note(`${COLLAPSE_CHORD} hid the side panel and brought it back: ${collapsed}`);

    const log = await gitLog(dir, [
      "bun scripts/drive.ts changes-panel",
      await gitSection(worktree, "status", "--short"),
      await gitSection(worktree, "for-each-ref", `refs/rde/checkpoints/${session.id}`),
      await gitSection(
        worktree,
        "diff",
        "--name-status",
        `refs/rde/checkpoints/${session.id}/0`,
        `refs/rde/checkpoints/${session.id}/1`,
      ),
      await gitSection(
        worktree,
        "diff",
        "--name-status",
        `refs/rde/checkpoints/${session.id}/1`,
        `refs/rde/checkpoints/${session.id}/2`,
      ),
    ]);
    await note(`git's own view of the session: ${log}`);
    if (consoleErrors.length > 0) {
      throw new DriverFailure(`the page logged errors:\n${consoleErrors.join("\n")}`);
    }
    await note("the page logged no error, the diff's highlighting worker included");

    await stopEverySession(window);
    await closeApp(running);
    return `${unified}, ${split}, ${perTurn}, ${reverted}, ${dark}, ${log}`;
  },
};

export async function seedRemote(repositoryPath: string): Promise<string> {
  const bare = await temporaryDir("rde-remote-");
  await git(bare, "init", "--quiet", "--bare");
  await git(repositoryPath, "remote", "add", "origin", PULL_REQUEST_REMOTE);
  await git(repositoryPath, "remote", "set-url", "--push", "origin", bare);
  await git(repositoryPath, "push", "--quiet", bare, "main");
  await git(repositoryPath, "fetch", "--quiet", bare, "main:refs/remotes/origin/main");
  return bare;
}

const OPENED_POLL_MS = 100;
const OPENED_POLLS = 50;

type OpenedCheck = (opened: OpenedExternally) => boolean;

async function openedExternally(window: Page, arrived: OpenedCheck): Promise<OpenedExternally> {
  for (let poll = 0; poll < OPENED_POLLS; poll += 1) {
    const opened = OpenedExternally.parse(
      await window.evaluate("window.rde.testOpenedExternally()"),
    );
    if (arrived(opened)) {
      return opened;
    }
    await window.waitForTimeout(OPENED_POLL_MS);
  }
  throw new DriverFailure("the app handed main nothing to open");
}

async function syncLine(window: Page): Promise<string> {
  return panel(window).locator("[data-sync]").innerText();
}

const COMMIT_PUSH: Scenario = {
  name: "commit-push",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    const bare = await seedRemote(repositoryPath);
    await note(`origin fetches from ${PULL_REQUEST_REMOTE} and pushes to ${bare}`);
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    await startWithAllPermissions(window, WRITE_PROMPT);
    await awaitCheckpoints(window, 1);
    const session = await newestSession(window);
    const workspace = session.workspace;
    if (workspace.kind !== "worktree") {
      throw new DriverFailure(`the session works ${workspace.kind}, not in a worktree`);
    }
    await note(`session ${session.id} on ${workspace.branch}`);
    await note(`before the commit: ${await syncLine(window)}`);

    await panel(window).getByRole("button", { name: "Commit", exact: true }).click();
    const commit = window.getByRole("dialog");
    const message = await commit.getByLabel("Message").inputValue();
    await note(`the commit message is prefilled with "${message}"`);
    if (message !== session.title) {
      throw new DriverFailure(
        `the message "${message}" is not the session title "${session.title}"`,
      );
    }
    await commit.getByRole("button", { name: "Commit", exact: true }).click();
    await commit.waitFor({ state: "detached" });
    await panel(window)
      .getByRole("button", { name: "Push", exact: true })
      .waitFor({ state: "visible" });
    await note(`after the commit: ${await syncLine(window)}`);

    await panel(window).getByRole("button", { name: "Push", exact: true }).click();
    const push = window.getByRole("dialog");
    await push
      .getByText("Pushed to origin.")
      .waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    const output = await push.getByLabel("Push output").innerText();
    await note(`git's push output as the dialog streamed it:\n${output.trimEnd()}`);
    const pushed = await shoot(window, dir, UNIT, "push-dialog");
    await push.getByRole("button", { name: "Close" }).click();
    await push.waitFor({ state: "detached" });

    const sync = panel(window).locator("[data-sync]");
    await sync.getByText("up to date", { exact: false }).waitFor({ state: "visible" });
    const line = await syncLine(window);
    await note(`the toolbar after the push: ${line}`);
    const remoteHead = (await git(bare, "rev-parse", workspace.branch)).trim();
    const localHead = (await git(workspace.path, "rev-parse", "HEAD")).trim();
    await note(`${bare} has ${workspace.branch} at ${remoteHead}; the worktree is at ${localHead}`);
    if (remoteHead !== localHead) {
      throw new DriverFailure("the bare remote does not hold the commit the worktree made");
    }

    await panel(window).getByRole("button", { name: "Open pull request" }).click();
    const expected = `https://github.com/metabase/rde-demo/compare/main...${workspace.branch}?expand=1`;
    const opened = await openedExternally(window, (seen) => seen.urls.length > 0);
    await note(`the app handed the OS ${opened.urls.join(", ")}`);
    if (opened.urls[0] !== expected) {
      throw new DriverFailure(
        `the pull request button opened ${String(opened.urls[0])}, not ${expected}`,
      );
    }
    const toolbar = await shoot(window, dir, UNIT, "pushed");
    await note(`the toolbar after the push: ${toolbar}`);

    await stopEverySession(window);
    await closeApp(running);
    return `${pushed}, ${toolbar}`;
  },
};

const FIRST_FILE_PROMPT = "Create a file named first.txt containing `one` and stop.";
const SECOND_FILE_PROMPT = "Create a file named second.txt containing `two` and stop.";
const RECALL_PROMPT =
  "Which files have you created in this conversation? Answer with their names only, and do not look at the disk.";

async function openSnapshot(window: Page, sessionId: string): Promise<SessionSnapshot> {
  return SessionSnapshot.parse(
    await window.evaluate(`window.rde.sessionsOpen({ sessionId: ${JSON.stringify(sessionId)} })`),
  );
}

async function lastAssistantText(window: Page): Promise<string> {
  return window.locator('[data-row="assistant"]').last().innerText();
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

const EDIT_FROM_HERE: Scenario = {
  name: "edit-from-here",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    await startWithAllPermissions(window, FIRST_FILE_PROMPT);
    await awaitCheckpoints(window, 1);
    await sendFollowUp(window, SECOND_FILE_PROMPT);
    await awaitCheckpoints(window, 2);
    const session = await newestSession(window);
    const worktree = session.workspace.path;
    await note(`two turns wrote first.txt and second.txt in ${worktree}`);
    const before = (await openSnapshot(window, session.id)).session;
    await note(`Claude Code's conversation before the edit: ${String(before.nativeSessionId)}`);

    const second = window.locator('[data-row="user"]').filter({ hasText: "second.txt" });
    await second.hover();
    await second.getByRole("button", { name: "Edit from here" }).click();
    const dialog = window.getByRole("dialog");
    await settle(window);
    const asked = await shoot(window, dir, UNIT, "edit-from-here-confirm");
    await note(`the confirm: ${(await dialog.innerText()).replaceAll("\n", " ")}; ${asked}`);
    await dialog.getByRole("checkbox").click();
    await dialog.getByRole("button", { name: "Edit from here" }).click();
    await dialog.waitFor({ state: "detached" });

    const draft = await window.locator("[data-prompt]").inputValue();
    await note(`the composer holds "${draft}"`);
    if (draft !== SECOND_FILE_PROMPT) {
      throw new DriverFailure("the rewound prompt did not return to the composer");
    }
    const prompts = await window.locator('[data-row="user"]').count();
    if (prompts !== 1) {
      throw new DriverFailure(
        `the timeline still shows ${String(prompts)} prompts after the rewind`,
      );
    }
    if (await exists(join(worktree, "second.txt"))) {
      throw new DriverFailure("second.txt is still in the worktree after restoring the files");
    }
    if (!(await exists(join(worktree, "first.txt")))) {
      throw new DriverFailure("first.txt went with the turn after it");
    }
    await note("the timeline is back to one prompt, second.txt is gone and first.txt stayed");
    const rewound = await shoot(window, dir, UNIT, "edit-from-here-rewound");

    await window.locator("[data-prompt]").fill(RECALL_PROMPT);
    await window.getByRole("button", { name: "Send", exact: true }).click();
    await awaitCheckpoints(window, 2);
    const answer = await lastAssistantText(window);
    await note(`asked what it created, the agent answered: ${answer}`);
    if (!answer.includes("first.txt") || answer.includes("second.txt")) {
      throw new DriverFailure("the conversation did not return to just before the second prompt");
    }
    const after = (await openSnapshot(window, session.id)).session;
    await note(
      `Claude Code's conversation after the edit: ${String(after.nativeSessionId)}, with ${after.replay === null ? "no transcript replayed" : "the transcript replayed"}`,
    );
    if (after.nativeSessionId === null || after.nativeSessionId === before.nativeSessionId) {
      throw new DriverFailure(
        "the session did not carry on from a fork of Claude Code's conversation",
      );
    }
    if (after.replay !== null) {
      throw new DriverFailure("Claude Code rewound its own conversation, yet the app replayed one");
    }
    const recalled = await shoot(window, dir, UNIT, "edit-from-here-recalled");

    await stopEverySession(window);
    await closeApp(running);
    return `${asked}, ${rewound}, ${recalled}`;
  },
};

const REVIEW_PROMPT =
  "Make exactly these edits and nothing else, then stop: in transforms/orders.sql change the first line to `-- cleaned orders`; in models/orders.yaml change `description: draft` to `description: cleaned`; delete notes.md with rm.";

const REVIEW_HOLD_MS = 2600;

async function hold(window: Page): Promise<void> {
  await window.waitForTimeout(REVIEW_HOLD_MS);
}

const CHANGES_REVIEW: Scenario = {
  name: "changes-review",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    await seedContent(repositoryPath);
    await seedRemote(repositoryPath);
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), undefined);
    const window = await openWindow(running, onWindow);

    await pointAtWorktreeRoot(window, note, repositoryPath, worktreeRoot);
    await startWithAllPermissions(window, REVIEW_PROMPT);
    await awaitCheckpoints(window, 1);
    await requireTreeFile(window, DELETED_FILE);
    await hold(window);

    await treeRow(window, REVERTED_FILE).click();
    await hold(window);
    await toggleDiffOption(window, SIDE_BY_SIDE);
    await hold(window);
    await toggleDiffOption(window, SIDE_BY_SIDE);
    await toggleDiffOption(window, WHOLE_FILES);
    await hold(window);
    await toggleDiffOption(window, WHOLE_FILES);

    await panel(window)
      .getByRole("button", { name: `Revert ${REVERTED_FILE}` })
      .click();
    const confirm = window.getByRole("dialog");
    await hold(window);
    await confirm.getByRole("button", { name: "Revert file" }).click();
    await confirm.waitFor({ state: "detached" });
    await requireTreeLacks(window, REVERTED_FILE);
    await hold(window);

    await panel(window).getByRole("button", { name: "Commit", exact: true }).click();
    const commit = window.getByRole("dialog");
    await hold(window);
    await commit.getByRole("button", { name: "Commit", exact: true }).click();
    await commit.waitFor({ state: "detached" });
    await panel(window).getByRole("button", { name: "Push", exact: true }).click();
    const push = window.getByRole("dialog");
    await push
      .getByText("Pushed to origin.")
      .waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    await hold(window);
    await push.getByRole("button", { name: "Close" }).click();
    await hold(window);

    await chooseTheme(window, "Dark");
    await hold(window);
    const shot = await shoot(window, dir, UNIT, "review-tour");
    await note(`the tour ended on ${shot}`);
    await stopEverySession(window);
    await closeApp(running);
    return shot;
  },
};

export const CHANGES_SCENARIOS: readonly Scenario[] = [
  CHANGES_PANEL,
  COMMIT_PUSH,
  EDIT_FROM_HERE,
  CHANGES_REVIEW,
];
