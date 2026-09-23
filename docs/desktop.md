# RDE desktop app

RDE runs Claude Code or Codex sessions against a Git repository that holds a Metabase instance's remote-sync content. The agent edits the YAML, checks it with the bundled `mb`, and the app pushes the session's branch and imports it into Metabase. This page covers installing the app, the first run, the content loop, where the app keeps its state and how the `mb` inside a session gets its credential.

## Install

Each build produces one installer per platform under `packages/desktop/release/`:

| Platform | File                                     | Notes                                |
| -------- | ---------------------------------------- | ------------------------------------ |
| Linux    | `metabase-rde-<version>-<arch>.AppImage` | Run `chmod +x` on it, then start it. |
| macOS    | `metabase-rde-<version>-<arch>.dmg`      | Drag the app to Applications.        |
| Windows  | `metabase-rde-<version>-<arch>.exe`      | An NSIS installer.                   |

The builds are unsigned. On macOS, open the app the first time from the Finder's context menu, because Gatekeeper refuses an unsigned app on a double-click. On Windows, SmartScreen asks for a confirmation.

To build an installer from source, use Bun (npm is too old for this workspace):

```sh
bun install
bun run dist:desktop:linux   # or dist:desktop:mac, dist:desktop:win
```

`dist:desktop:<platform>` builds the client, the CLI and the app, then runs electron-builder with `packages/desktop/electron-builder.yml`. The `Desktop` CI workflow builds each installer on its own platform and runs the Linux AppImage under `xvfb-run` through `scripts/smoke.ts` and `scripts/release-smoke.ts`.

## First run

The main window opens on a checklist with three steps. A session cannot start until all three are done.

1. Connect to Metabase. Type the instance URL. The app signs in with OAuth when the instance offers it, where a person holding an API key can use that instead, and asks for an API key when it does not, saying why.
2. Pick the repository. This is the checkout that holds the instance's remote-sync content.
3. Install an agent. The app looks for `claude` and `codex` on the login shell's `PATH`. Sign in to the agent in a terminal first (`claude`, or `codex login`).

Each step opens its own page of Settings. Settings (the gear button, or `Cmd+,`) fills the window with one section at a time: Metabase, Repository, Agents and Appearance, listed down the left, with Back to app above them and `Escape` to leave. It changes any of the steps later, and also sets the theme, the editor that opens a changed file, and the directory that holds session worktrees.

A new session runs in a new worktree on branch `rde/<slug>`, or in the repository itself. When the repository has an executable `.rde/setup`, the app runs it in each new worktree before the first turn.

## The content loop

Content is files. Collections, cards, dashboards, documents, segments, measures, snippets, transforms and table metadata are YAML in the repository. `mb` has no command that creates, changes or deletes them in Metabase. A session's loop is:

1. The agent edits the YAML and runs `mb validate` on it.
2. The agent, or the Changes panel, commits the branch.
3. **Sync to Metabase** in the Metabase panel pushes the branch when origin does not have it, then runs `mb git-sync import --branch <branch>`. The panel shows the result and links to the collections, dashboards and transforms the import changed.
4. The agent proves the change with `mb transform run`, `mb transform-test run` or `mb card query`.

The agent reads the connected instance's database schema through `mb`, database to schema to table to field (`mb db list`, `mb db get`, `mb table get`, `mb field get`); nothing about the schema is written to the checkout. The panel offers to add `.scratch/`, the agent's scratch directory, to `.gitignore`, so that it is not committed.

Remote sync is a Metabase Enterprise feature. On an instance without it, the panel says why it cannot sync and the Sync button stays disabled.

## Keyboard

`Cmd+K` (`Ctrl+K` on Windows and Linux) opens a palette over the sessions and the app's actions: a new session, either side-panel tab, and each Settings section. Type to narrow it, move with the arrow keys and press `Enter`. The other shortcuts are listed beside their actions in the palette. In the composer, `Enter` sends, `Shift+Enter` breaks the line and `Cmd+Enter` sends and keeps a fresh draft.

## Where state lives

| What                                                  | Where                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Settings, including the encrypted Metabase credential | `settings.json` in the app's data directory                          |
| Each session's event log                              | `sessions/<id>/events.jsonl` in the app's data directory             |
| Each agent's raw protocol log                         | `logs/providers/` in the app's data directory                        |
| Session worktrees                                     | `~/metabase-rde/worktrees/` unless Settings names another directory  |
| Checkpoints, one per turn                             | hidden refs `refs/rde/checkpoints/<session>/<seq>` in the repository |
| A downloaded update                                   | `@metabaserde-desktop-updater/` under the user's cache directory     |

The app's data directory is `~/.config/RDE` on Linux, `~/Library/Application Support/RDE` on macOS and `%APPDATA%\RDE` on Windows.

A checkpoint is a tree under a hidden ref, so the session's branch gains no commit from it and the staging area is untouched. The event log is the session; the app rebuilds everything it shows about a session from that file.

## How `mb` inside a session authenticates

The app holds the Metabase credential and nothing else does. It encrypts the credential with the operating system's secret store through Electron `safeStorage`. When the machine offers no secret store, the app refuses to save the credential and says how to fix it; it never stores the credential as plain text.

While the app runs, a token broker listens on a loopback port. Every agent session starts with three variables set:

- `MB_URL`, the connected instance.
- `MB_AUTH_BROKER`, the broker's address.
- `MB_AUTH_BROKER_TOKEN`, a token for this session alone.

`mb` asks the broker for an access token, and asks it to refresh the token once when Metabase answers 401. The refresh token never leaves the app. The app revokes a session's broker token when the session stops.

The `mb` a session runs is the app's own. The app puts `resources/rde-cli/bin` first on the agent's `PATH`. Its `mb` shim runs `resources/rde-cli/dist/cli.mjs` with the app's own executable as Node (`ELECTRON_RUN_AS_NODE=1`), so a different `mb` or Node installed on the machine does not change what the agent runs. `MB_SKILLS_DIR` points `mb skills` at the skills bundled beside the CLI.

## Updates

A packaged app checks the GitHub releases for a newer version when it starts and every six hours. A newer version shows a notice with **Download**. When the download finishes, **Restart** installs it. The app never downloads an update without the click.
