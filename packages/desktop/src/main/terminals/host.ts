import type { SessionEnvironment } from "../../contracts/connection";
import type { Session, SessionSnapshot } from "../../contracts/session";
import type {
  TerminalExit,
  TerminalInput,
  TerminalOpenRequest,
  TerminalOpened,
  TerminalOutput,
  TerminalResize,
} from "../../contracts/terminal";
import type { PtyProcess, StartPty } from "../process/pty";

const SHELL_ENV_VAR = "SHELL";
const COMSPEC_ENV_VAR = "COMSPEC";
const MAC_SHELL = "/bin/zsh";
const UNIX_SHELL = "/bin/bash";
const WINDOWS_SHELL = "powershell.exe";
const LOGIN_ARGS = ["-l"] as const;

// The renderer paints 24-bit colour, and a program only uses it when the terminal says so.
const TERMINAL_ENV = { COLORTERM: "truecolor", TERM_PROGRAM: "RDE" } as const;

export interface ShellCommand {
  readonly shell: string;
  readonly args: readonly string[];
}

// A login shell reads the person's profile, so the terminal has the `PATH` and prompt they expect.
export function userShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): ShellCommand {
  if (platform === "win32") {
    return { shell: env[COMSPEC_ENV_VAR] ?? WINDOWS_SHELL, args: [] };
  }
  const configured = env[SHELL_ENV_VAR];
  if (configured !== undefined && configured.length > 0) {
    return { shell: configured, args: LOGIN_ARGS };
  }
  return { shell: platform === "darwin" ? MAC_SHELL : UNIX_SHELL, args: LOGIN_ARGS };
}

export interface TerminalHostDeps {
  readonly open: (sessionId: string) => Promise<SessionSnapshot>;
  readonly environment: (
    session: Session,
    broker: SessionEnvironment | null,
  ) => Promise<NodeJS.ProcessEnv>;
  readonly mintBrokerSession: () => SessionEnvironment | null;
  readonly revokeBrokerSession: (brokerSessionId: string) => void;
  readonly shell: ShellCommand;
  readonly startPty: StartPty;
  readonly newId: () => string;
  readonly publishOutput: (output: TerminalOutput) => void;
  readonly publishExit: (exit: TerminalExit) => void;
}

interface LiveTerminal {
  readonly sessionId: string;
  readonly pty: PtyProcess;
  readonly brokerSessionId: string | null;
}

// Every shell a person opened beside a session. A terminal lives until its tab closes, its
// session is archived or deleted, the shell exits, or the app quits.
export class TerminalHost {
  private readonly live = new Map<string, LiveTerminal>();

  constructor(private readonly deps: TerminalHostDeps) {}

  async open(request: TerminalOpenRequest): Promise<TerminalOpened> {
    const snapshot = await this.deps.open(request.sessionId);
    const session = snapshot.session;
    const broker = this.deps.mintBrokerSession();
    const brokerSessionId = broker === null ? null : broker.sessionId;
    const terminalId = this.deps.newId();
    try {
      const env = await this.deps.environment(session, broker);
      const pty = this.deps.startPty({
        shell: this.deps.shell.shell,
        args: this.deps.shell.args,
        cwd: session.workspace.path,
        env: { ...env, ...TERMINAL_ENV },
        cols: request.cols,
        rows: request.rows,
      });
      this.live.set(terminalId, { sessionId: session.id, pty, brokerSessionId });
      pty.onData((data) => {
        this.deps.publishOutput({ terminalId, data });
      });
      pty.onExit((exit) => {
        this.release(terminalId);
        this.deps.publishExit({ terminalId, exitCode: exit.exitCode, signal: exit.signal });
      });
    } catch (error) {
      if (brokerSessionId !== null) {
        this.deps.revokeBrokerSession(brokerSessionId);
      }
      throw error;
    }
    return { terminalId };
  }

  // Keystrokes and resizes race the shell's exit, so one addressed to a terminal that is gone is
  // dropped rather than refused.
  write(input: TerminalInput): void {
    this.live.get(input.terminalId)?.pty.write(input.data);
  }

  resize(request: TerminalResize): void {
    this.live.get(request.terminalId)?.pty.resize(request.cols, request.rows);
  }

  close(terminalId: string): void {
    const terminal = this.release(terminalId);
    terminal?.pty.kill();
  }

  closeSession(sessionId: string): void {
    for (const [terminalId, terminal] of this.live) {
      if (terminal.sessionId === sessionId) {
        this.close(terminalId);
      }
    }
  }

  closeAll(): void {
    for (const terminalId of this.live.keys()) {
      this.close(terminalId);
    }
  }

  private release(terminalId: string): LiveTerminal | null {
    const terminal = this.live.get(terminalId);
    if (terminal === undefined) {
      return null;
    }
    this.live.delete(terminalId);
    if (terminal.brokerSessionId !== null) {
      this.deps.revokeBrokerSession(terminal.brokerSessionId);
    }
    return terminal;
  }
}
