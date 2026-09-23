import { ChevronDown, GitCommitHorizontal, Info, OctagonX, Upload } from "lucide-react";
import { memo, type ReactElement } from "react";

import { assertNever } from "../../../contracts/assert-never";
import type { CheckpointRow, FoldRow, NoticeRow, SyncRow, TurnRow } from "@/timeline/rows";
import { changeLabel, filesLabel, foldLabel } from "@/timeline/labels";
import { PlainButton } from "../ui/plain-button";

const MARKER_ROW = "flex items-center gap-2 py-1 text-detail text-ink-3";

interface FoldProps {
  readonly row: FoldRow;
  readonly onToggle: (turnId: string) => void;
}

export const Fold = memo(function Fold({ row, onToggle }: FoldProps): ReactElement {
  return (
    <PlainButton
      data-row="fold"
      aria-expanded={false}
      onClick={() => {
        onToggle(row.turnId);
      }}
      className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 text-detail text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink-2"
    >
      {foldLabel(row.fold)}
      <ChevronDown aria-hidden className="size-3.5 shrink-0" />
    </PlainButton>
  );
});

interface CheckpointProps {
  readonly row: CheckpointRow;
}

export const Checkpoint = memo(function Checkpoint({ row }: CheckpointProps): ReactElement {
  return (
    <div data-row="checkpoint" className={MARKER_ROW}>
      <GitCommitHorizontal aria-hidden className="size-3.5 shrink-0" />
      <span>{filesLabel(row.item.files.length)}</span>
      <ul className="flex min-w-0 flex-wrap gap-x-3">
        {row.item.files.map((file) => (
          <li key={file.path} className="flex min-w-0 gap-1.5">
            <span className="truncate text-ink-2">{file.path}</span>
            <span className="shrink-0 tabular-nums">{changeLabel(file.added, file.removed)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

interface TurnEndProps {
  readonly row: TurnRow;
}

const STOPPED_SENTENCE = "You stopped this response";

export const TurnEnd = memo(function TurnEnd({ row }: TurnEndProps): ReactElement {
  const outcome = row.outcome;
  switch (outcome.kind) {
    case "interrupted": {
      return (
        <div data-row="turn" data-turn-outcome="interrupted" className={MARKER_ROW}>
          <OctagonX aria-hidden className="size-3.5 shrink-0" />
          {STOPPED_SENTENCE}
        </div>
      );
    }
    case "failed": {
      return (
        <div data-row="turn" data-turn-outcome="failed" className={`${MARKER_ROW} text-red`}>
          <OctagonX aria-hidden className="size-3.5 shrink-0" />
          {outcome.message}
        </div>
      );
    }
    default: {
      return assertNever(outcome);
    }
  }
});

interface SyncProps {
  readonly row: SyncRow;
}

export const Sync = memo(function Sync({ row }: SyncProps): ReactElement {
  const outcome = row.item.outcome;
  const failed = outcome.kind === "failed";
  return (
    <div
      data-row="sync"
      data-sync-outcome={outcome.kind}
      className={failed ? `${MARKER_ROW} text-red` : MARKER_ROW}
    >
      <Upload aria-hidden className="size-3.5 shrink-0" />
      <span className="font-mono text-ink-2">{row.item.branch}</span>
      <span className="min-w-0 truncate">
        {outcome.kind === "failed" ? outcome.message : "imported into Metabase"}
      </span>
    </div>
  );
});

interface NoticeProps {
  readonly row: NoticeRow;
}

export const Notice = memo(function Notice({ row }: NoticeProps): ReactElement {
  return (
    <div data-row="notice" className={MARKER_ROW}>
      <Info aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{row.item.text}</span>
    </div>
  );
});
