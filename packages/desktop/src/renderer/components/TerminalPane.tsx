import { TerminalSquare } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type ReactElement } from "react";

import { assertNever } from "../../contracts/assert-never";
import {
  acquireTerminal,
  restartShell,
  startShell,
  type TerminalHandle,
  type TerminalState,
} from "@/terminal/registry";

import { Button } from "./ui/button";
import { EmptyLoading, EmptyProblem } from "./ui/empty";

interface TerminalPaneProps {
  readonly tabId: string;
  readonly sessionId: string;
}

// The surface lives in the registry and outlives this pane; mounting parents its host element and
// unmounting hides it, so a tab switch keeps the shell and its scrollback.
export function TerminalPane({ tabId, sessionId }: TerminalPaneProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const handle = acquireTerminal(tabId, sessionId);
  const state = useSyncExternalStore(handle.state.subscribe, handle.state.read);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    container.append(handle.host);
    let mounted = true;
    handle.ready.then(
      (surface) => {
        if (!mounted) {
          return;
        }
        surface.setVisible(true);
        surface.fit();
        surface.focus();
        void startShell(handle);
      },
      () => {
        // The registry carries the failure into `state`.
      },
    );
    return () => {
      mounted = false;
      handle.surface()?.setVisible(false);
      handle.host.remove();
    };
  }, [handle]);

  return (
    <section aria-label="Terminal" className="flex min-h-0 flex-1 flex-col bg-surface">
      <ExitBar state={state} handle={handle} />
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 py-1 pl-2" />
        <Overlay state={state} />
      </div>
    </section>
  );
}

interface ExitBarProps {
  readonly state: TerminalState;
  readonly handle: TerminalHandle;
}

function exitLabel(state: TerminalState): string | null {
  switch (state.kind) {
    case "starting":
    case "running": {
      return null;
    }
    case "failed": {
      return "The shell did not start.";
    }
    case "exited": {
      if (state.signal !== null) {
        return `The shell was stopped by signal ${state.signal}.`;
      }
      return state.exitCode === 0
        ? "The shell exited."
        : `The shell exited with code ${state.exitCode}.`;
    }
    default: {
      return assertNever(state);
    }
  }
}

function ExitBar({ state, handle }: ExitBarProps): ReactElement | null {
  const label = exitLabel(state);
  if (label === null) {
    return null;
  }
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <p className="min-w-0 flex-1 truncate text-body text-ink-2">{label}</p>
      <Button
        variant="outline"
        size="xs"
        onClick={() => {
          restartShell(handle);
        }}
      >
        {state.kind === "failed" ? "Try again" : "New shell"}
      </Button>
    </div>
  );
}

interface OverlayProps {
  readonly state: TerminalState;
}

function Overlay({ state }: OverlayProps): ReactElement | null {
  switch (state.kind) {
    case "running":
    case "exited": {
      return null;
    }
    case "starting": {
      return (
        <div className="absolute inset-0 flex bg-surface">
          <EmptyLoading label="Starting the shell" />
        </div>
      );
    }
    case "failed": {
      return (
        <div className="absolute inset-0 flex bg-surface">
          <EmptyProblem
            icon={TerminalSquare}
            label="The terminal could not start"
            summary={state.reason}
            detail={state.reason}
          />
        </div>
      );
    }
    default: {
      return assertNever(state);
    }
  }
}
