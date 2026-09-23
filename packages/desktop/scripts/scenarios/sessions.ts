import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "playwright";

import {
  SessionIndex,
  SessionSnapshot,
  type SessionIndexEntry,
  type TimelineItem,
} from "../../src/contracts/session";
import { DriverFailure, closeApp, descendantsOf, timestamp, type RunningApp } from "../app";
import {
  IN_PLACE_OPTION,
  TURN_TIMEOUT_MS,
  THEME_ENV_VAR,
  WORKTREE_OPTION,
  awaitRow,
  chooseRepository,
  closeSettings,
  expectVisible,
  git,
  openFoldedWork,
  openSettings,
  openWindow,
  readTranscript,
  requireLine,
  requireRow,
  seedRepository,
  sendFollowUp,
  start,
  startSession,
  temporaryDir,
  writeSetupScript,
  type Note,
  type Scenario,
} from "../scenario";

const UNIT = "u4";

const WRITE_PROMPT = "Create a file named hello.txt containing hello and stop.";
const SECOND_PROMPT = "Reply with the word ready and stop.";
const TARGET_FILE = "hello.txt";
const SETUP_LINE = "rde setup ran";
const SETUP_PROMPT_LABEL = "Prepare the worktree";

async function pointAtRepository(
  window: Page,
  note: Note,
  repositoryPath: string,
  worktreeRoot: string | null,
): Promise<void> {
  await expectVisible(window, "Finish setting up");
  await openSettings(window, note);
  await window.getByRole("button", { name: "Repository", exact: true }).click();
  await chooseRepository(window, repositoryPath);
  await expectVisible(window, repositoryPath);
  await note(`repository ${repositoryPath}`);
  if (worktreeRoot !== null) {
    await window.getByLabel("Worktree root").fill(worktreeRoot);
    await window.getByRole("button", { name: "Save worktree root" }).click();
    await expectVisible(window, "Saved");
    await note(`worktree root ${worktreeRoot}`);
  }
  await closeSettings(window);
}

async function allowOnce(window: Page, note: Note): Promise<void> {
  const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
  await allow.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  await note("the agent asked to write, and the driver allowed it");
  await allow.click();
}

async function awaitCheckpoint(window: Page, note: Note): Promise<string> {
  const text = await awaitRow(window, "checkpoint");
  await note(`checkpoint row: ${text}`);
  return text;
}

async function readSessions(window: Page): Promise<SessionIndexEntry[]> {
  const listed: unknown = await window.evaluate("window.rde.sessionsList()");
  return SessionIndex.parse(listed).sessions;
}

function newestSession(sessions: readonly SessionIndexEntry[]): SessionIndexEntry {
  const entry = sessions[0];
  if (entry === undefined) {
    throw new DriverFailure("the app recorded no session");
  }
  return entry;
}

async function stopEverySession(
  window: Page,
  sessions: readonly SessionIndexEntry[],
): Promise<void> {
  for (const entry of sessions) {
    await window.evaluate(`window.rde.sessionsStop({ sessionId: ${JSON.stringify(entry.id)} })`);
  }
}

async function requireFile(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new DriverFailure(`${path} was not written`);
  }
}

const SESSION_WORKTREE: Scenario = {
  name: "session-worktree",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    await writeSetupScript(repositoryPath, SETUP_LINE);
    const worktreeRoot = await temporaryDir("rde-worktrees-");
    const running = await start(await temporaryDir("rde-userdata-"), process.env[THEME_ENV_VAR]);
    const window = await openWindow(running, onWindow);

    await pointAtRepository(window, note, repositoryPath, worktreeRoot);
    await startSession(window, WRITE_PROMPT, WORKTREE_OPTION);
    await allowOnce(window, note);
    const checkpointRow = await awaitCheckpoint(window, note);

    const session = newestSession(await readSessions(window));
    const workspace = session.workspace;
    if (workspace.kind !== "worktree") {
      throw new DriverFailure(`the session works ${workspace.kind}, not in a worktree`);
    }
    await note(`session ${session.id} on ${workspace.branch} at ${workspace.path}`);

    if (workspace.path !== join(worktreeRoot, workspace.branch.replace("rde/", ""))) {
      throw new DriverFailure(`${workspace.path} is not under ${worktreeRoot}`);
    }
    await requireFile(join(workspace.path, TARGET_FILE));
    const branch = requireLine(
      await git(workspace.path, "symbolic-ref", "--short", "HEAD"),
      "branch",
    );
    if (branch !== workspace.branch) {
      throw new DriverFailure(`the checkout is on ${branch}, not ${workspace.branch}`);
    }

    const first = `refs/rde/checkpoints/${session.id}/0`;
    const second = `refs/rde/checkpoints/${session.id}/1`;
    const numstat = await git(repositoryPath, "diff", first, second, "--numstat");
    if (!numstat.includes(TARGET_FILE)) {
      throw new DriverFailure(`${first}..${second} names no ${TARGET_FILE}: ${numstat}`);
    }
    if (!checkpointRow.includes(TARGET_FILE)) {
      throw new DriverFailure(`the timeline's checkpoint row names no ${TARGET_FILE}`);
    }
    await openFoldedWork(window, SETUP_PROMPT_LABEL);
    await expectVisible(window, SETUP_LINE);
    await note(`the worktree setup script ran and printed "${SETUP_LINE}"`);

    const logPath = join(dir, `${timestamp()}_${UNIT}-git.log`);
    await writeGitLog(logPath, repositoryPath, workspace.path, session, numstat);
    await note(`git state: ${logPath}`);

    const shot = join(dir, `${timestamp()}_${UNIT}-worktree.png`);
    await window.screenshot({ path: shot });
    await stopEverySession(window, await readSessions(window));
    await closeApp(running);
    return `${shot}, ${logPath}`;
  },
};

async function writeGitLog(
  path: string,
  repositoryPath: string,
  worktreePath: string,
  session: SessionIndexEntry,
  numstat: string,
): Promise<void> {
  const refs = await git(repositoryPath, "for-each-ref", "--format=%(refname)", "refs/rde");
  const branches = await git(repositoryPath, "branch", "--list", "--format=%(refname:short)");
  const status = await git(worktreePath, "status", "--porcelain");
  await writeFile(
    path,
    [
      `bun run --filter @metabase/rde-desktop build && xvfb-run -a bun scripts/drive.ts session-worktree   # ${session.id}`,
      "",
      "# git for-each-ref refs/rde",
      refs.trim(),
      "",
      "# git branch --list",
      branches.trim(),
      "",
      `# git diff <checkpoint 0> <checkpoint 1> --numstat`,
      numstat.trim(),
      "",
      "# git status --porcelain, in the worktree",
      status.trim().length === 0 ? "(clean)" : status.trim(),
      "",
    ].join("\n"),
    "utf8",
  );
}

const SESSION_IN_PLACE: Scenario = {
  name: "session-in-place",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    const running = await start(await temporaryDir("rde-userdata-"), process.env[THEME_ENV_VAR]);
    const window = await openWindow(running, onWindow);

    await pointAtRepository(window, note, repositoryPath, null);
    await startSession(window, WRITE_PROMPT, IN_PLACE_OPTION);
    await allowOnce(window, note);
    await awaitCheckpoint(window, note);

    const session = newestSession(await readSessions(window));
    if (session.workspace.kind !== "in-place") {
      throw new DriverFailure(`the session works ${session.workspace.kind}, not in place`);
    }
    if (session.workspace.path !== repositoryPath) {
      throw new DriverFailure(`the session works in ${session.workspace.path}`);
    }
    await requireFile(join(repositoryPath, TARGET_FILE));
    const branches = await git(repositoryPath, "branch", "--list", "--format=%(refname:short)");
    if (branches.includes("rde/")) {
      throw new DriverFailure(`an in-place session created a branch: ${branches}`);
    }
    await note(`the repository is still on ${branches.trim()} with no branch created`);

    await window.getByRole("button", { name: "New session" }).click();
    await startSession(window, SECOND_PROMPT, IN_PLACE_OPTION);
    const warning = window.getByRole("note").filter({ hasText: "in this checkout" });
    await warning.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    await note(`shared checkout warning: ${await warning.innerText()}`);

    const shot = join(dir, `${timestamp()}_${UNIT}-in-place.png`);
    await window.screenshot({ path: shot });
    await stopEverySession(window, await readSessions(window));
    await closeApp(running);
    return shot;
  },
};

async function killWithChildren(running: RunningApp): Promise<void> {
  const main = running.app.process();
  if (main.pid === undefined) {
    throw new DriverFailure("Electron main process has no pid");
  }
  const children = await descendantsOf(main.pid);
  main.kill("SIGKILL");
  for (const pid of children) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      continue;
    }
  }
}

const SESSION_RECOVERY: Scenario = {
  name: "session-recovery",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    const userDataDir = await temporaryDir("rde-userdata-");
    const first = await start(userDataDir, process.env[THEME_ENV_VAR]);
    const window = await openWindow(first, onWindow);

    await pointAtRepository(window, note, repositoryPath, null);
    await startSession(window, WRITE_PROMPT, IN_PLACE_OPTION);
    const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
    await allow.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    const session = newestSession(await readSessions(window));
    await note(`session ${session.id} is mid-turn with a request waiting`);

    await killWithChildren(first);
    await note("killed the app with SIGKILL, leaving the turn and the request open");

    const second = await start(userDataDir, process.env[THEME_ENV_VAR]);
    const reopened = await openWindow(second, onWindow);
    await reopened.getByRole("button", { name: session.title }).click();
    await note(`reopened ${session.id}`);

    const transcript = await readTranscript(reopened);
    await note(
      `the session's timeline after the relaunch:\n${transcript
        .map((row) => `${row.kind}: ${row.text}`)
        .join("\n")}`,
    );
    requireRow(transcript, "user", WRITE_PROMPT);
    requireRow(transcript, "tool", "Stopped before this finished.");
    requireRow(transcript, "request", "Expired before an answer");
    requireRow(transcript, "turn", "You stopped this response");

    const shot = join(dir, `${timestamp()}_${UNIT}-recovery.png`);
    await reopened.screenshot({ path: shot });
    await closeApp(second);
    return shot;
  },
};

const DEATH_UNIT = "u9";
const LONG_COMMAND_PROMPT =
  "Run the shell command `python3 -c 'import time; time.sleep(90)'` in the foreground, wait for it to finish, and then say done.";
const FOLLOW_UP_PROMPT = "Say done and stop.";
const DEATH_TURN_MESSAGE =
  "Claude Code stopped in the middle of this turn. Send a message to carry on; the conversation picks up where it stopped.";
const DEATH_TOOL_MESSAGE = "Claude Code stopped before this finished.";
// The SDK launches Claude Code streaming JSON; the `--version` probe and anything the agent runs
// do not carry this argument.
const SDK_STREAM_ARGUMENT = "stream-json";
const ARGUMENT_SEPARATOR = "\0";
// Long enough for the allowed command to be running inside Claude Code when it dies.
const COMMAND_SETTLE_MS = 3_000;

const EXITED_NOTE = "Claude Code exited: ";

// A process that exits between listing and reading has no command line left to read.
async function commandLine(pid: number): Promise<readonly string[] | null> {
  try {
    return (await readFile(`/proc/${pid}/cmdline`, "utf8")).split(ARGUMENT_SEPARATOR);
  } catch {
    return null;
  }
}

async function exitLine(userDataDir: string, sessionId: string): Promise<string> {
  const log = await readFile(join(userDataDir, "logs", "providers", `${sessionId}.log`), "utf8");
  const line = log.split("\n").find((candidate) => candidate.startsWith(EXITED_NOTE));
  if (line === undefined) {
    throw new DriverFailure(`the provider log holds no line starting "${EXITED_NOTE}"`);
  }
  return line;
}

async function claudeCodeProcess(running: RunningApp): Promise<number> {
  const main = running.app.process();
  if (main.pid === undefined) {
    throw new DriverFailure("Electron main process has no pid");
  }
  for (const pid of await descendantsOf(main.pid)) {
    const argv = await commandLine(pid);
    if (argv !== null && argv.includes(SDK_STREAM_ARGUMENT)) {
      return pid;
    }
  }
  throw new DriverFailure("no Claude Code process runs under the app");
}

async function openSessionSnapshot(window: Page, sessionId: string): Promise<SessionSnapshot> {
  return SessionSnapshot.parse(
    await window.evaluate(`window.rde.sessionsOpen({ sessionId: ${JSON.stringify(sessionId)} })`),
  );
}

const SNAPSHOT_POLL_MS = 1_000;

type TurnItem = Extract<TimelineItem, { readonly kind: "turn" }>;

function turnsOf(snapshot: SessionSnapshot): TurnItem[] {
  return snapshot.items.filter((item): item is TurnItem => item.kind === "turn");
}

async function awaitTurns(window: Page, sessionId: string, count: number): Promise<TurnItem[]> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const turns = turnsOf(await openSessionSnapshot(window, sessionId));
    if (turns.length >= count) {
      return turns;
    }
    await delay(SNAPSHOT_POLL_MS);
  }
  throw new DriverFailure(`the session did not reach ${count} finished turns`);
}

async function allowIfAsked(window: Page, note: Note): Promise<void> {
  const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
  const running = window.locator('[data-row="tool"][data-tool-state="running"]').first();
  await allow.or(running).first().waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  if (await allow.isVisible()) {
    await allow.click();
    await note("the agent asked to run the command, and the driver allowed it");
  }
  await running.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
}

const PROVIDER_DEATH: Scenario = {
  name: "provider-death",
  unit: DEATH_UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    const userDataDir = await temporaryDir("rde-userdata-");
    const running = await start(userDataDir, process.env[THEME_ENV_VAR]);
    const window = await openWindow(running, onWindow);

    await pointAtRepository(window, note, repositoryPath, null);
    await startSession(window, LONG_COMMAND_PROMPT, IN_PLACE_OPTION);
    await window
      .locator('[data-row="working"]')
      .waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    await note("the Working row shows");
    await allowIfAsked(window, note);
    await delay(COMMAND_SETTLE_MS);
    const session = newestSession(await readSessions(window));

    if ((await window.locator('[data-row="working"]').count()) === 0) {
      throw new DriverFailure("the turn ended before the driver could kill Claude Code mid-turn");
    }
    const pid = await claudeCodeProcess(running);
    process.kill(pid, "SIGKILL");
    await note(`killed Claude Code (pid ${pid}) with SIGKILL while its command ran`);

    const failedTurn = window.locator('[data-row="turn"][data-turn-outcome="failed"]');
    await failedTurn.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    const failedText = await failedTurn.innerText();
    if (failedText !== DEATH_TURN_MESSAGE) {
      throw new DriverFailure(`the failed turn reads "${failedText}"`);
    }
    await note(`the turn closed as failed: ${failedText}`);
    await awaitRow(window, "checkpoint");
    const transcript = await readTranscript(window);
    await note(
      `the timeline after the kill:\n${transcript.map((row) => `${row.kind}: ${row.text}`).join("\n")}`,
    );
    const stillRunning = await window
      .locator('[data-row="tool"][data-tool-state="running"]')
      .count();
    if (stillRunning !== 0) {
      throw new DriverFailure(`${stillRunning} tool rows still read as running`);
    }
    if ((await window.locator('[data-row="working"]').count()) !== 0) {
      throw new DriverFailure("the Working row outlived the dead provider");
    }
    const failed = await openSessionSnapshot(window, session.id);
    if (failed.session.activity.kind !== "idle") {
      throw new DriverFailure(`the session reads ${failed.session.activity.kind}, not idle`);
    }
    const tools = failed.items.filter((item) => item.kind === "tool");
    if (!tools.some((item) => item.output === DEATH_TOOL_MESSAGE)) {
      throw new DriverFailure(`no tool closed with "${DEATH_TOOL_MESSAGE}"`);
    }
    await note(
      `every tool closed; the session is idle; the killed command reads "${DEATH_TOOL_MESSAGE}"`,
    );
    const raw = await exitLine(userDataDir, session.id);
    const rawError = raw.slice(EXITED_NOTE.length);
    if (transcript.some((row) => row.text.includes(rawError))) {
      throw new DriverFailure(`the timeline shows the raw error "${rawError}"`);
    }
    await note(`the provider log holds "${raw}", and the timeline does not`);
    const failedShot = join(dir, `${timestamp()}_${DEATH_UNIT}-provider-death.png`);
    await window.screenshot({ path: failedShot });

    await sendFollowUp(window, FOLLOW_UP_PROMPT);
    await note(`sent "${FOLLOW_UP_PROMPT}"`);
    const turns = await awaitTurns(window, session.id, 2);
    const last = turns[turns.length - 1];
    if (last === undefined || last.outcome.kind !== "completed") {
      throw new DriverFailure(`the follow-up turn ended ${JSON.stringify(last?.outcome)}`);
    }
    await note(
      `the follow-up turn completed on a fresh Claude Code (pid ${await claudeCodeProcess(running)})`,
    );
    const resumedShot = join(dir, `${timestamp()}_${DEATH_UNIT}-provider-death-resumed.png`);
    await window.screenshot({ path: resumedShot });

    await stopEverySession(window, await readSessions(window));
    await closeApp(running);
    return `${failedShot}, ${resumedShot}`;
  },
};

export const SESSION_SCENARIOS: readonly Scenario[] = [
  SESSION_WORKTREE,
  SESSION_IN_PLACE,
  SESSION_RECOVERY,
  PROVIDER_DEATH,
];
