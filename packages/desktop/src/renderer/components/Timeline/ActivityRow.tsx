import {
  ChevronRight,
  FileText,
  Globe,
  Pencil,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { memo, type ReactElement } from "react";

import type { ToolKind } from "../../../contracts/events";
import type { ActivityRow as ActivityRowModel, ToolItem } from "@/timeline/rows";
import { cn } from "@/cn";

import { CodeBlock } from "../agent/CodeBlock";
import { GlideMenu } from "../agent/GlideMenu";
import { PlainButton } from "../ui/plain-button";

const TOOL_GLYPHS: Readonly<Record<ToolKind, LucideIcon>> = {
  command: Terminal,
  read: FileText,
  edit: Pencil,
  search: Search,
  web: Globe,
  other: Wrench,
};

const TOOL_STATE_TONES = {
  running: "text-ink-3",
  ok: "text-ink-3",
  error: "text-red",
} as const;

type ToolTone = keyof typeof TOOL_STATE_TONES;

function toneOf(tool: ToolItem): ToolTone {
  if (tool.state.kind === "running") {
    return "running";
  }
  return tool.state.status === "error" ? "error" : "ok";
}

const RUNNING_NOTE = "running";
const WAITING_NOTE = "waiting for you";
const FAILED_NOTE = "failed";

function noteOf(tool: ToolItem, waiting: boolean): string | null {
  if (tool.state.kind === "running") {
    return waiting ? WAITING_NOTE : RUNNING_NOTE;
  }
  return tool.state.status === "error" ? FAILED_NOTE : null;
}

function opensByDefault(tool: ToolItem): boolean {
  return tool.state.kind === "finished" && tool.state.status === "error";
}

function bodyOf(tool: ToolItem): string | null {
  if (tool.patch !== null) {
    return tool.patch;
  }
  return tool.output.trim().length === 0 ? null : tool.output;
}

interface ToolLineProps {
  readonly tool: ToolItem;
  readonly waiting: boolean;
  readonly open: boolean;
  readonly onToggle: (callId: string) => void;
}

function ToolLine({ tool, waiting, open, onToggle }: ToolLineProps): ReactElement {
  const Glyph = TOOL_GLYPHS[tool.tool];
  const note = noteOf(tool, waiting);
  const body = bodyOf(tool);
  return (
    <li data-row="tool" data-tool-state={toneOf(tool)}>
      <PlainButton
        data-menu-row
        aria-expanded={open}
        disabled={body === null}
        onClick={() => {
          onToggle(tool.callId);
        }}
        className="relative z-10 flex w-full items-center gap-2 rounded-control px-2 py-1 text-left disabled:cursor-default"
      >
        <Glyph aria-hidden className={cn("size-3.5 shrink-0", TOOL_STATE_TONES[toneOf(tool)])} />
        <span className="min-w-0 flex-1 truncate text-detail text-ink-2">{tool.label}</span>
        {note === null ? null : (
          <span className={cn("text-detail", TOOL_STATE_TONES[toneOf(tool)])}>{note}</span>
        )}
        {body === null ? null : (
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-ink-3 transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        )}
      </PlainButton>
      {open && body !== null ? (
        <div className="relative z-10 py-1 pl-7">
          <CodeBlock filename={tool.files[0] ?? null} text={body} />
        </div>
      ) : null}
    </li>
  );
}

interface ActivityProps {
  readonly row: ActivityRowModel;
  readonly disclosures: ReadonlyMap<string, boolean>;
  readonly onToggle: (callId: string) => void;
}

export const Activity = memo(function Activity({
  row,
  disclosures,
  onToggle,
}: ActivityProps): ReactElement {
  return (
    <div data-row="activity" data-activity-status={row.status} className="min-w-0">
      <GlideMenu>
        <ul className="flex flex-col">
          {row.tools.map((tool) => (
            <ToolLine
              key={tool.callId}
              tool={tool}
              waiting={row.awaiting.has(tool.callId)}
              open={disclosures.get(tool.callId) ?? opensByDefault(tool)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </GlideMenu>
    </div>
  );
});
