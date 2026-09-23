import { rde } from "@/bridge";
import { actionFor } from "@/keybindings";
import { keyPlatform } from "@/platform";

import { GhosttyTerminalSurface } from "./ghostty/surface";
import { documentTerminalTheme } from "./theme";

interface TerminalStarting {
  readonly kind: "starting";
}

interface TerminalRunning {
  readonly kind: "running";
}

interface TerminalExited {
  readonly kind: "exited";
  readonly exitCode: number;
  readonly signal: number | null;
}

interface TerminalFailed {
  readonly kind: "failed";
  readonly reason: string;
}

export type TerminalState = TerminalStarting | TerminalRunning | TerminalExited | TerminalFailed;

export interface TerminalStore {
  readonly read: () => TerminalState;
  readonly subscribe: (listener: () => void) => () => void;
}

// One surface per terminal tab for the life of the page. The pane mounts and unmounts the
// surface's host element, so switching tabs or sessions never loses the shell or its scrollback;
// only closing the tab disposes it.
export interface TerminalHandle {
  readonly tabId: string;
  readonly sessionId: string;
  readonly host: HTMLDivElement;
  readonly state: TerminalStore;
  readonly ready: Promise<GhosttyTerminalSurface>;
  readonly surface: () => GhosttyTerminalSurface | null;
}

interface Entry {
  readonly handle: TerminalHandle;
  readonly setState: (next: TerminalState) => void;
  surface: GhosttyTerminalSurface | null;
  terminalId: string | null;
  opening: boolean;
  closed: boolean;
}

const STARTING: TerminalStarting = { kind: "starting" };
const RUNNING: TerminalRunning = { kind: "running" };
const THEME_ATTRIBUTES = ["class", "data-theme"];
// The self-hosted face in fonts.css; the surface adds its own symbol and monospace fallbacks.
const TERMINAL_FONT_FAMILY = "JetBrains Mono";

const entries = new Map<string, Entry>();
const byTerminalId = new Map<string, Entry>();
let wired = false;

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Escape belongs to the shell; every other app-wide chord still reaches the window's listener.
function shellKeepsKey(event: KeyboardEvent): boolean {
  const action = actionFor(event, "global", keyPlatform());
  return action === null || action === "close-topmost";
}

function wireOnce(): void {
  if (wired) {
    return;
  }
  wired = true;
  rde.onTerminalOutput((output) => {
    byTerminalId.get(output.terminalId)?.surface?.write(output.data);
  });
  rde.onTerminalExit((exit) => {
    const entry = byTerminalId.get(exit.terminalId);
    if (entry === undefined) {
      return;
    }
    byTerminalId.delete(exit.terminalId);
    entry.terminalId = null;
    entry.setState({ kind: "exited", exitCode: exit.exitCode, signal: exit.signal });
  });
  // The theme flips by a class on <html>; the tokens the surfaces paint with follow it.
  new MutationObserver(() => {
    const theme = documentTerminalTheme();
    for (const entry of entries.values()) {
      entry.surface?.setTheme(theme);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
}

interface MutableTerminalStore extends TerminalStore {
  readonly set: (next: TerminalState) => void;
}

function store(initial: TerminalState): MutableTerminalStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      value = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function create(tabId: string, sessionId: string): Entry {
  wireOnce();
  const host = document.createElement("div");
  host.className = "relative size-full";
  const state = store(STARTING);
  const ready = GhosttyTerminalSurface.create(host, {
    theme: documentTerminalTheme(),
    font: { family: TERMINAL_FONT_FAMILY },
    visible: false,
    onData: (data) => {
      const terminalId = entry.terminalId;
      if (terminalId !== null) {
        void rde.terminalWrite({ terminalId, data });
      }
    },
    onResize: (cols, rows) => {
      const terminalId = entry.terminalId;
      if (terminalId !== null) {
        void rde.terminalResize({ terminalId, cols, rows });
      }
    },
    onSelectionChange: () => {},
    beforeKey: shellKeepsKey,
    onLinkActivate: (url) => {
      window.open(url);
    },
  });
  const entry: Entry = {
    handle: {
      tabId,
      sessionId,
      host,
      state,
      ready,
      surface: () => entry.surface,
    },
    setState: state.set,
    surface: null,
    terminalId: null,
    opening: false,
    closed: false,
  };
  ready.then(
    (surface) => {
      if (entry.closed) {
        surface.dispose();
        return;
      }
      entry.surface = surface;
    },
    (error: unknown) => {
      state.set({ kind: "failed", reason: failureReason(error) });
    },
  );
  return entry;
}

export function acquireTerminal(tabId: string, sessionId: string): TerminalHandle {
  const existing = entries.get(tabId);
  if (existing !== undefined) {
    return existing.handle;
  }
  const entry = create(tabId, sessionId);
  entries.set(tabId, entry);
  return entry.handle;
}

// The shell starts on the first show, once the surface has measured its font and knows the grid
// the shell is given.
export async function startShell(handle: TerminalHandle): Promise<void> {
  const entry = entries.get(handle.tabId);
  if (entry === undefined || entry.opening || handle.state.read().kind !== "starting") {
    return;
  }
  entry.opening = true;
  try {
    const surface = await handle.ready;
    if (entry.closed) {
      return;
    }
    surface.fit();
    const opened = await rde.terminalOpen({
      sessionId: handle.sessionId,
      cols: surface.cols,
      rows: surface.rows,
    });
    if (entry.closed) {
      void rde.terminalClose({ terminalId: opened.terminalId });
      return;
    }
    entry.terminalId = opened.terminalId;
    byTerminalId.set(opened.terminalId, entry);
    entry.setState(RUNNING);
  } catch (error) {
    entry.setState({ kind: "failed", reason: failureReason(error) });
  } finally {
    entry.opening = false;
  }
}

// A new shell in the same tab, after the last one exited or failed to start.
export function restartShell(handle: TerminalHandle): void {
  const entry = entries.get(handle.tabId);
  if (entry === undefined) {
    return;
  }
  entry.surface?.reset();
  entry.setState(STARTING);
  void startShell(handle);
}

export function closeTerminal(tabId: string): void {
  const entry = entries.get(tabId);
  if (entry === undefined) {
    return;
  }
  entries.delete(tabId);
  entry.closed = true;
  const terminalId = entry.terminalId;
  if (terminalId !== null) {
    byTerminalId.delete(terminalId);
    void rde.terminalClose({ terminalId });
  }
  entry.surface?.dispose();
  entry.handle.host.remove();
}
