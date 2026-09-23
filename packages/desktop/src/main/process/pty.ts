import { spawn } from "node-pty";

export interface PtyRequest {
  readonly shell: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cols: number;
  readonly rows: number;
}

export interface PtyExit {
  readonly exitCode: number;
  readonly signal: number | null;
}

export interface PtyProcess {
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: () => void;
  readonly onData: (listener: (data: string) => void) => void;
  readonly onExit: (listener: (exit: PtyExit) => void) => void;
}

export type StartPty = (request: PtyRequest) => PtyProcess;

// The terminal type the renderer's VT engine answers to, so programs draw with its full palette.
const TERMINAL_NAME = "xterm-256color";

export const startPty: StartPty = (request) => {
  const pty = spawn(request.shell, [...request.args], {
    name: TERMINAL_NAME,
    cwd: request.cwd,
    env: request.env,
    cols: request.cols,
    rows: request.rows,
  });
  return {
    write: (data) => {
      pty.write(data);
    },
    resize: (cols, rows) => {
      pty.resize(cols, rows);
    },
    kill: () => {
      pty.kill();
    },
    onData: (listener) => {
      pty.onData(listener);
    },
    onExit: (listener) => {
      pty.onExit(({ exitCode, signal }) => {
        listener({ exitCode, signal: signal === undefined || signal === 0 ? null : signal });
      });
    },
  };
};
