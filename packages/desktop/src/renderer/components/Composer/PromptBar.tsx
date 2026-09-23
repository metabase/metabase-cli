import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { assertNever } from "../../../contracts/assert-never";
import type { ComposerTrigger } from "@/composer/triggers";
import { applyTrigger, matchCommands, matchPaths, triggerAt } from "@/composer/triggers";
import { actionFor } from "@/keybindings";
import { keyPlatform } from "@/platform";

import { GlideMenu } from "../agent/GlideMenu";
import { Textarea } from "../ui/textarea";

const SUGGESTION_LIMIT = 8;
const SUGGESTION_LIST_ID = "composer-suggestions";

function suggestionId(index: number): string {
  return `${SUGGESTION_LIST_ID}-${String(index)}`;
}

export type SubmitMode = "send" | "send-and-draft";

function suggestionsFor(
  trigger: ComposerTrigger,
  files: readonly string[],
  commands: readonly string[],
): readonly string[] {
  return trigger.kind === "mention"
    ? matchPaths(files, trigger.query, SUGGESTION_LIMIT)
    : matchCommands(commands, trigger.query, SUGGESTION_LIMIT);
}

function step(highlight: number, delta: number, length: number): number {
  return (highlight + delta + length) % length;
}

export interface PromptBarProps {
  readonly value: string;
  // Counts the times something outside the field asked for the focus, as a mention does.
  readonly focusRequests: number;
  readonly placeholder: string;
  readonly files: readonly string[];
  readonly commands: readonly string[];
  readonly disabled: boolean;
  readonly controls: ReactNode;
  readonly action: ReactNode;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (mode: SubmitMode) => void;
}

export function PromptBar({
  value,
  focusRequests,
  placeholder,
  files,
  commands,
  disabled,
  controls,
  action,
  onChange,
  onSubmit,
}: PromptBarProps): ReactElement {
  const field = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const answeredRequests = useRef(focusRequests);

  // Sending the first message swaps the new-session field for the session's, and the focus the old
  // field held falls to the page; the new field takes it so typing carries on.
  useEffect(() => {
    const element = field.current;
    if (element !== null && document.activeElement === document.body) {
      element.focus();
    }
  }, []);

  useEffect(() => {
    const element = field.current;
    if (focusRequests === answeredRequests.current || element === null) {
      return;
    }
    answeredRequests.current = focusRequests;
    const end = element.value.length;
    element.focus();
    element.setSelectionRange(end, end);
    setCaret(end);
  }, [focusRequests]);

  const trigger = dismissed ? null : triggerAt(value, caret);
  const suggestions = trigger === null ? [] : suggestionsFor(trigger, files, commands);
  const open = suggestions.length > 0;

  const pick = useCallback(
    (at: ComposerTrigger, suggestion: string): void => {
      const edit = applyTrigger(value, at, suggestion);
      onChange(edit.text);
      setCaret(edit.cursor);
      setHighlight(0);
      const element = field.current;
      if (element !== null) {
        element.focus();
        element.setSelectionRange(edit.cursor, edit.cursor);
      }
    },
    [onChange, value],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
      if (open && trigger !== null) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setHighlight((current) =>
            step(current, event.key === "ArrowDown" ? 1 : -1, suggestions.length),
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const chosen = suggestions[highlight];
          if (chosen !== undefined) {
            event.preventDefault();
            pick(trigger, chosen);
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDismissed(true);
          return;
        }
      }
      const pressed = actionFor(event, "composer", keyPlatform());
      if (pressed === null) {
        return;
      }
      switch (pressed) {
        case "send": {
          event.preventDefault();
          onSubmit("send");
          return;
        }
        case "send-and-draft": {
          event.preventDefault();
          onSubmit("send-and-draft");
          return;
        }
        case "blur": {
          event.currentTarget.blur();
          return;
        }
        case "newline":
        case "new-session":
        case "open-palette":
        case "toggle-changes":
        case "open-settings":
        case "close-topmost": {
          return;
        }
        default: {
          assertNever(pressed);
        }
      }
    },
    [highlight, onSubmit, open, pick, suggestions, trigger],
  );

  const onEdit = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      setDismissed(false);
      setHighlight(0);
      setCaret(event.target.selectionStart);
      onChange(event.target.value);
    },
    [onChange],
  );

  const followCaret = useCallback((): void => {
    const element = field.current;
    if (element !== null) {
      setCaret(element.selectionStart);
    }
  }, []);

  return (
    <div data-prompt-bar className="@container relative rounded-card bg-surface shadow-card">
      {open && trigger !== null ? (
        <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-card bg-surface p-1 shadow-overlay">
          <GlideMenu>
            <ul
              id={SUGGESTION_LIST_ID}
              role="listbox"
              aria-label="Suggestions"
              className="flex flex-col"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion}
                  id={suggestionId(index)}
                  role="option"
                  data-menu-row
                  aria-selected={index === highlight}
                  className="relative z-10 cursor-default truncate rounded-control px-2 py-1 text-body text-ink-2 aria-selected:text-ink"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(trigger, suggestion);
                  }}
                >
                  {suggestion}
                </li>
              ))}
            </ul>
          </GlideMenu>
        </div>
      ) : null}
      <Textarea
        ref={field}
        data-prompt
        rows={1}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-label={placeholder}
        aria-expanded={open}
        aria-controls={SUGGESTION_LIST_ID}
        aria-activedescendant={open ? suggestionId(highlight) : undefined}
        placeholder={placeholder}
        onChange={onEdit}
        onKeyDown={onKeyDown}
        onKeyUp={followCaret}
        onClick={followCaret}
        className="max-h-48 min-h-11 resize-none border-0 bg-transparent px-3.5 py-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
        {controls}
        <div className="ml-auto shrink-0">{action}</div>
      </div>
    </div>
  );
}
