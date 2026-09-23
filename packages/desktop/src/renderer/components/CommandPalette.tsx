import { Search } from "lucide-react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { useEffect, useId, useMemo, useState } from "react";

import type { SessionIndexEntry } from "../../contracts/session";
import { cn } from "@/cn";
import { KEY_BINDINGS, chordName } from "@/keybindings";
import type { KeyAction } from "@/keybindings";
import type { PaletteCommand, PaletteItem } from "@/palette";
import { movedSelection, paletteItems } from "@/palette";
import { keyPlatform } from "@/platform";

import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

const TITLE = "Search sessions and actions";
const NOTHING_FOUND = "No matches";
const STEP_DOWN = 1;
const STEP_UP = -1;

function shortcutOf(action: KeyAction | null): string | null {
  const binding = KEY_BINDINGS.find((candidate) => candidate.action === action);
  return binding === undefined ? null : chordName(binding.chord, keyPlatform());
}

interface CommandPaletteProps {
  readonly open: boolean;
  readonly sessions: readonly SessionIndexEntry[];
  readonly onRun: (command: PaletteCommand) => void;
  readonly onClose: () => void;
}

export function CommandPalette({
  open,
  sessions,
  onRun,
  onClose,
}: CommandPaletteProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="top-24 max-w-lg translate-y-0 gap-0 p-0 data-ending-style:scale-100 data-starting-style:scale-100">
        {open ? <PaletteBody sessions={sessions} onRun={onRun} /> : null}
      </DialogContent>
    </Dialog>
  );
}

interface PaletteBodyProps {
  readonly sessions: readonly SessionIndexEntry[];
  readonly onRun: (command: PaletteCommand) => void;
}

function PaletteBody({ sessions, onRun }: PaletteBodyProps): ReactElement {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const items = useMemo(() => paletteItems(sessions, query), [sessions, query]);
  const active = items[selected] ?? null;
  const activeId = active === null ? null : optionId(listId, active);

  useEffect(() => {
    if (activeId !== null) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? STEP_DOWN : STEP_UP;
      setSelected((current) => movedSelection(current, step, items.length));
      return;
    }
    if (event.key === "Enter" && active !== null) {
      event.preventDefault();
      onRun(active.command);
    }
  };

  return (
    <>
      <DialogTitle className="sr-only">{TITLE}</DialogTitle>
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
        <Input
          autoFocus
          role="combobox"
          aria-label={TITLE}
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeId ?? undefined}
          placeholder={TITLE}
          value={query}
          className="h-11 border-0 bg-transparent px-0 focus-visible:ring-0 dark:bg-transparent"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-body text-ink-3">{NOTHING_FOUND}</p>
      ) : (
        <div
          id={listId}
          role="listbox"
          aria-label={TITLE}
          className="max-h-96 overflow-y-auto p-1.5"
        >
          {items.map((item, index) => (
            <PaletteOption
              key={item.id}
              id={optionId(listId, item)}
              item={item}
              heading={index === 0 || items[index - 1]?.group !== item.group}
              selected={index === selected}
              onPoint={() => {
                setSelected(index);
              }}
              onRun={() => {
                onRun(item.command);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

function optionId(listId: string, item: PaletteItem): string {
  return `${listId}-${item.id}`;
}

interface PaletteOptionProps {
  readonly id: string;
  readonly item: PaletteItem;
  readonly heading: boolean;
  readonly selected: boolean;
  readonly onPoint: () => void;
  readonly onRun: () => void;
}

function PaletteOption({
  id,
  item,
  heading,
  selected,
  onPoint,
  onRun,
}: PaletteOptionProps): ReactElement {
  const shortcut = shortcutOf(item.binding);
  return (
    <>
      {heading ? (
        <div role="presentation" className="px-2.5 pt-2 pb-1 text-meta font-medium text-ink-3">
          {item.group}
        </div>
      ) : null}
      <div
        id={id}
        role="option"
        aria-selected={selected}
        onPointerMove={onPoint}
        onClick={onRun}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 text-body",
          selected ? "bg-inset text-ink" : "text-ink-2",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.detail === null ? null : (
          <span className="max-w-48 shrink-0 truncate text-meta text-ink-3">{item.detail}</span>
        )}
        {shortcut === null ? null : (
          <kbd className="shrink-0 font-sans text-meta text-ink-3">{shortcut}</kbd>
        )}
      </div>
    </>
  );
}
