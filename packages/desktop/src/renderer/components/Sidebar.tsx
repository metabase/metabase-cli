import { Archive, ArchiveRestore, Pin, PinOff, Plus, Search } from "lucide-react";
import { useMemo, useState, type ChangeEvent, type KeyboardEvent, type ReactElement } from "react";

import type { SessionIndexEntry } from "../../contracts/session";
import { cn } from "@/cn";
import type { PulseTone, SessionPulse } from "@/pulse";
import { RESTING, toneOf } from "@/pulse";
import { movedSelection } from "@/palette";
import { archivedCount, visibleSessions } from "@/session-list";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { PlainButton } from "./ui/plain-button";

const NEW_SESSION_LABEL = "New session";
const SEARCH_LABEL = "Search sessions";
const ARCHIVE_LABEL = "Archive";
const PIN_LABEL = "Pin";
const UNPIN_LABEL = "Unpin";
const IN_PLACE_LABEL = "in the repository";
const NO_MATCHES = "No matches";
const NO_ARCHIVE = "Nothing archived";

const STATUS_TONES: Readonly<Record<PulseTone, string>> = {
  running: "bg-accent",
  waiting: "border border-accent",
  idle: "bg-transparent",
  failed: "bg-red",
};

const STATUS_TITLES: Readonly<Record<PulseTone, string>> = {
  running: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  failed: "Failed",
};

function workspaceLabel(entry: SessionIndexEntry): string {
  return entry.workspace.kind === "worktree" ? entry.workspace.branch : IN_PLACE_LABEL;
}

interface StatusDotProps {
  readonly tone: PulseTone;
}

function StatusDot({ tone }: StatusDotProps): ReactElement {
  return (
    <span
      role="img"
      aria-label={STATUS_TITLES[tone]}
      className={cn("mt-1.75 size-1.5 shrink-0 rounded-full", STATUS_TONES[tone])}
    />
  );
}

interface SessionRowProps {
  readonly entry: SessionIndexEntry;
  readonly tone: PulseTone;
  readonly current: boolean;
  readonly onOpen: (sessionId: string) => void;
  readonly onPin: (sessionId: string, pinned: boolean) => void;
  readonly onArchive: (sessionId: string) => void;
}

function SessionRow({
  entry,
  tone,
  current,
  onOpen,
  onPin,
  onArchive,
}: SessionRowProps): ReactElement {
  const archived = entry.lifecycle === "archived";
  return (
    <li
      data-session-row
      data-session-status={tone}
      className={cn(
        "group flex items-start gap-2 rounded-control px-2 py-1.5 transition-colors duration-100",
        current ? "bg-inset" : "hover:bg-hover",
      )}
    >
      <StatusDot tone={tone} />
      <PlainButton
        data-session-open
        aria-current={current}
        onClick={() => {
          onOpen(entry.id);
        }}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-body text-ink">{entry.title}</span>
        <span className="block truncate text-meta text-ink-3">{workspaceLabel(entry)}</span>
      </PlainButton>
      <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={entry.pinned ? UNPIN_LABEL : PIN_LABEL}
          onClick={() => {
            onPin(entry.id, !entry.pinned);
          }}
        >
          {entry.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={ARCHIVE_LABEL}
          disabled={archived}
          onClick={() => {
            onArchive(entry.id);
          }}
        >
          <Archive aria-hidden />
        </Button>
      </span>
    </li>
  );
}

const SESSION_OPENER = "[data-session-open]";
const STEP_DOWN = 1;
const STEP_UP = -1;

// Up and down move between the sessions the way they do in a list, so the keyboard does not have to
// pass each row's pin and archive buttons to reach the next session.
function moveBetweenSessions(event: KeyboardEvent<HTMLUListElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  const openers = [...event.currentTarget.querySelectorAll<HTMLElement>(SESSION_OPENER)];
  const focused = event.target instanceof HTMLElement ? event.target.closest("li") : null;
  const at = openers.findIndex((opener) => opener.closest("li") === focused);
  if (at === -1) {
    return;
  }
  event.preventDefault();
  const step = event.key === "ArrowDown" ? STEP_DOWN : STEP_UP;
  openers[movedSelection(at, step, openers.length)]?.focus();
}

interface EmptyListProps {
  readonly archived: boolean;
  readonly query: string;
}

// An empty list with no search says nothing: New session above it is the next step.
function EmptyList({ archived, query }: EmptyListProps): ReactElement | null {
  if (archived) {
    return <p className="px-2 py-1 text-body text-ink-3">{NO_ARCHIVE}</p>;
  }
  if (query.length === 0) {
    return null;
  }
  return <p className="px-2 py-1 text-body text-ink-3">{NO_MATCHES}</p>;
}

export interface SidebarProps {
  readonly sessions: readonly SessionIndexEntry[];
  readonly pulses: ReadonlyMap<string, SessionPulse>;
  readonly openId: string | null;
  readonly onOpen: (sessionId: string) => void;
  readonly onNew: () => void;
  readonly onPin: (sessionId: string, pinned: boolean) => void;
  readonly onArchive: (sessionId: string) => void;
}

export function Sidebar({
  sessions,
  pulses,
  openId,
  onOpen,
  onNew,
  onPin,
  onArchive,
}: SidebarProps): ReactElement {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);

  const shown = useMemo(
    () => visibleSessions(sessions, { query, archived }),
    [archived, query, sessions],
  );
  const putAway = archivedCount(sessions);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <PlainButton
        onClick={onNew}
        className="-mx-2 flex items-center gap-2 rounded-control px-2 py-1.5 text-body font-medium text-ink transition-colors duration-100 hover:bg-hover"
      >
        <Plus aria-hidden className="size-4 text-ink-2" />
        {NEW_SESSION_LABEL}
      </PlainButton>
      <div className="relative">
        <Search aria-hidden className="absolute top-2 left-2 size-3.5 text-ink-3" />
        <Input
          type="search"
          value={query}
          aria-label={SEARCH_LABEL}
          placeholder={SEARCH_LABEL}
          className="h-7 pl-7"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setQuery(event.target.value);
          }}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyList archived={archived} query={query} />
      ) : (
        <ul
          aria-label="Sessions"
          className="-mx-2 min-h-0 flex-1 overflow-y-auto"
          onKeyDown={moveBetweenSessions}
        >
          {shown.map((entry) => (
            <SessionRow
              key={entry.id}
              entry={entry}
              tone={toneOf(pulses.get(entry.id) ?? RESTING)}
              current={entry.id === openId}
              onOpen={onOpen}
              onPin={onPin}
              onArchive={onArchive}
            />
          ))}
        </ul>
      )}
      {putAway === 0 ? null : (
        <Button
          variant="ghost"
          size="xs"
          className="justify-start text-ink-3"
          onClick={() => {
            setArchived(!archived);
          }}
        >
          <ArchiveRestore aria-hidden />
          {archived ? "Back to active sessions" : `Archived (${String(putAway)})`}
        </Button>
      )}
    </div>
  );
}
