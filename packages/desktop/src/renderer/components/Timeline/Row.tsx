import { memo, type ReactElement } from "react";

import { assertNever } from "../../../contracts/assert-never";
import type { TimelineRow } from "@/timeline/rows";

import { Approval } from "../agent/Approval";

import { Activity } from "./ActivityRow";
import { Checkpoint, Fold, Notice, Sync, TurnEnd } from "./MarkerRows";
import { AssistantMessage, Reasoning, UserMessage, Working } from "./MessageRows";

export interface TimelineActions {
  readonly onToggleTurn: (turnId: string) => void;
  readonly onToggleDisclosure: (id: string) => void;
  readonly onAnswer: (requestId: string, optionId: string, text: string | null) => void;
  readonly onEditFrom: (turnId: string, text: string) => void;
}

export interface RowProps {
  readonly row: TimelineRow;
  readonly disclosures: ReadonlyMap<string, boolean>;
  readonly busy: boolean;
  readonly actions: TimelineActions;
}

function content({ row, disclosures, busy, actions }: RowProps): ReactElement {
  switch (row.kind) {
    case "user": {
      return <UserMessage row={row} editable={!busy} onEditFrom={actions.onEditFrom} />;
    }
    case "assistant": {
      return <AssistantMessage row={row} />;
    }
    case "reasoning": {
      return (
        <Reasoning
          row={row}
          open={disclosures.get(row.id) === true}
          onToggle={actions.onToggleDisclosure}
        />
      );
    }
    case "activity": {
      return <Activity row={row} disclosures={disclosures} onToggle={actions.onToggleDisclosure} />;
    }
    case "request": {
      return (
        <div data-row="request" data-request-open={row.item.resolution === null}>
          <Approval
            kind={row.item.request}
            prompt={row.item.prompt}
            options={row.item.options}
            acceptsText={row.item.acceptsText}
            resolution={row.item.resolution}
            busy={busy}
            onAnswer={(optionId, text) => {
              actions.onAnswer(row.item.requestId, optionId, text);
            }}
          />
        </div>
      );
    }
    case "checkpoint": {
      return <Checkpoint row={row} />;
    }
    case "turn": {
      return <TurnEnd row={row} />;
    }
    case "sync": {
      return <Sync row={row} />;
    }
    case "notice": {
      return <Notice row={row} />;
    }
    case "fold": {
      return <Fold row={row} onToggle={actions.onToggleTurn} />;
    }
    case "working": {
      return <Working label={row.label} startedAt={row.startedAt} />;
    }
    default: {
      return assertNever(row);
    }
  }
}

export const Row = memo(function Row(props: RowProps): ReactElement {
  return <div className="timeline-row px-6 py-1.5">{content(props)}</div>;
});
