import { Paperclip, Undo2 } from "lucide-react";
import { memo, useEffect, useState, type ReactElement } from "react";

import type { AssistantRow, ReasoningRow, UserRow } from "@/timeline/rows";
import { durationLabel } from "@/timeline/labels";

import { CopyButton } from "../agent/CopyButton";
import { Button } from "../ui/button";
import { ShimmerText } from "../agent/Shimmer";
import { StreamCaret } from "../agent/StreamCaret";
import { Thinking } from "../agent/Thinking";

import { Markdown } from "./Markdown";

const THINKING_LABEL = "Thinking";
const REASONING_LABEL = "Reasoning";

const EDIT_FROM_LABEL = "Edit from here";

interface UserMessageProps {
  readonly row: UserRow;
  readonly editable: boolean;
  readonly onEditFrom: (turnId: string, text: string) => void;
}

export const UserMessage = memo(function UserMessage({
  row,
  editable,
  onEditFrom,
}: UserMessageProps): ReactElement {
  return (
    <div data-row="user" className="group flex flex-col items-end gap-1">
      <div className="flex items-start gap-1">
        <span className="flex opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={EDIT_FROM_LABEL}
            title={EDIT_FROM_LABEL}
            disabled={!editable}
            onClick={() => {
              onEditFrom(row.item.turnId, row.item.text);
            }}
          >
            <Undo2 aria-hidden />
          </Button>
          <CopyButton text={row.item.text} showLabel={false} />
        </span>
        <div className="max-w-2xl rounded-card bg-surface px-3.5 py-2.5 text-body whitespace-pre-wrap text-ink shadow-card">
          {row.item.text}
        </div>
      </div>
      {row.item.attachments.length === 0 ? null : (
        <ul className="flex flex-wrap justify-end gap-1">
          {row.item.attachments.map((path) => (
            <li
              key={path}
              className="flex items-center gap-1 rounded-chip bg-inset px-1.5 py-0.5 text-meta text-ink-2"
            >
              <Paperclip aria-hidden className="size-3 shrink-0" />
              {path}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

interface AssistantMessageProps {
  readonly row: AssistantRow;
}

export const AssistantMessage = memo(function AssistantMessage({
  row,
}: AssistantMessageProps): ReactElement {
  return (
    <div data-row="assistant" className="group flex min-w-0 flex-col">
      <Markdown text={row.item.text} state={row.streaming ? "streaming" : "settled"} />
      {row.streaming ? (
        <StreamCaret />
      ) : (
        <span className="mt-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton text={row.item.text} showLabel={false} />
        </span>
      )}
    </div>
  );
});

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0];
  return line === undefined || line.length === 0 ? THINKING_LABEL : line;
}

interface ReasoningProps {
  readonly row: ReasoningRow;
  readonly open: boolean;
  readonly onToggle: (rowId: string) => void;
}

export const Reasoning = memo(function Reasoning({
  row,
  open,
  onToggle,
}: ReasoningProps): ReactElement {
  const summary = row.streaming ? firstLine(row.item.text) : REASONING_LABEL;
  return (
    <div data-row="reasoning" className="flex min-w-0 flex-col">
      <Thinking
        summary={summary}
        working={row.streaming}
        open={open}
        onToggle={() => {
          onToggle(row.id);
        }}
      >
        <p className="text-body whitespace-pre-wrap text-ink-2">{row.item.text}</p>
      </Thinking>
    </div>
  );
});

const TICK_MS = 1000;

interface WorkingProps {
  readonly label: string;
  readonly startedAt: string;
}

export const Working = memo(function Working({ label, startedAt }: WorkingProps): ReactElement {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const elapsed = durationLabel(Math.max(now - new Date(startedAt).getTime(), 0));
  return (
    <div data-row="working" className="flex items-center gap-2 py-1">
      <ShimmerText text={label} live />
      <span className="text-meta text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  );
});
