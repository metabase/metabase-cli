import { useCallback, useMemo, useState, type ReactElement } from "react";

import type { ActionOutcome } from "../../contracts/changes";
import type { ProviderHealth } from "../../contracts/providers";
import { pendingRequests } from "../../contracts/projector";
import type { SessionSnapshot } from "../../contracts/session";
import { buildRows } from "@/timeline/rows";

import { SessionComposer } from "./Composer";
import { EditFromHere, type EditPoint } from "./EditFromHere";
import { Timeline } from "./Timeline";
import type { TimelineActions } from "./Timeline/Row";
import { WindowStrip } from "./ui/window-strip";

const WORKTREE_PREFIX = "on";
const IN_PLACE_LABEL = "in the repository";

export interface SessionViewProps {
  readonly snapshot: SessionSnapshot;
  readonly providers: readonly ProviderHealth[];
  readonly files: readonly string[];
  readonly draft: string;
  readonly focusRequests: number;
  readonly working: boolean;
  readonly onDraft: (text: string) => void;
  readonly onSend: (text: string) => void;
  readonly onAnswer: (requestId: string, optionId: string) => void;
  readonly onInterrupt: () => void;
  readonly onRewind: (turnId: string, restoreFiles: boolean) => Promise<ActionOutcome>;
}

function toggled(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

export function SessionView({
  snapshot,
  providers,
  files,
  draft,
  focusRequests,
  working,
  onDraft,
  onSend,
  onAnswer,
  onInterrupt,
  onRewind,
}: SessionViewProps): ReactElement {
  const [editing, setEditing] = useState<EditPoint | null>(null);
  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<string>>(new Set<string>());
  const [disclosures, setDisclosures] = useState<ReadonlyMap<string, boolean>>(new Map());

  const rows = useMemo(() => buildRows(snapshot, { expandedTurns }), [expandedTurns, snapshot]);

  const actions = useMemo<TimelineActions>(
    () => ({
      onToggleTurn: (turnId) => {
        setExpandedTurns((current) => toggled(current, turnId));
      },
      onToggleDisclosure: (id) => {
        setDisclosures((current) => new Map(current).set(id, current.get(id) !== true));
      },
      onAnswer: (requestId, optionId) => {
        onAnswer(requestId, optionId);
      },
      onEditFrom: (turnId, text) => {
        setEditing({ turnId, text });
      },
    }),
    [onAnswer],
  );

  const rewind = useCallback(
    async (point: EditPoint, restoreFiles: boolean): Promise<ActionOutcome> => {
      const outcome = await onRewind(point.turnId, restoreFiles);
      if (outcome.kind === "done") {
        onDraft(point.text);
      }
      return outcome;
    },
    [onDraft, onRewind],
  );

  const send = useCallback(
    (text: string) => {
      onSend(text);
      onDraft("");
    },
    [onDraft, onSend],
  );

  const session = snapshot.session;
  const workspace = session.workspace;
  const where =
    workspace.kind === "worktree" ? `${WORKTREE_PREFIX} ${workspace.branch}` : IN_PLACE_LABEL;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <WindowStrip className="gap-2 px-6">
        <h1 className="truncate text-body font-medium text-ink">{session.title}</h1>
        <span className="shrink-0 text-meta text-ink-3">{where}</span>
        {session.activity.kind === "failed" ? (
          <p role="alert" className="truncate text-body text-red">
            {session.activity.reason}
          </p>
        ) : null}
      </WindowStrip>
      <Timeline rows={rows} disclosures={disclosures} busy={working} actions={actions} />
      <EditFromHere
        point={editing}
        workspace={workspace}
        onClose={() => {
          setEditing(null);
        }}
        onConfirm={rewind}
      />
      <div className="shrink-0 px-6 pb-4">
        <SessionComposer
          session={session}
          providers={providers}
          pending={pendingRequests(snapshot)}
          running={session.activity.kind === "running"}
          busy={working}
          files={files}
          draft={draft}
          focusRequests={focusRequests}
          onDraft={onDraft}
          onSend={send}
          onInterrupt={onInterrupt}
          onAnswer={onAnswer}
        />
      </div>
    </section>
  );
}
