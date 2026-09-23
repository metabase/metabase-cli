import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
  type MaintainScrollAtEndOptions,
  type MaintainVisibleContentPositionConfig,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "@legendapp/list/react";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { cn } from "@/cn";
import { SETTLES_ON_RESIZE } from "@/panels";
import type { ScrollMetrics } from "@/timeline/follow";
import type { TimelineRow, TimelineRowKind } from "@/timeline/rows";
import { atEnd, canScroll } from "@/timeline/follow";

import { Row, type TimelineActions } from "./Row";

import "./timeline.css";
import { PlainButton } from "../ui/plain-button";

const ESTIMATED_ROW_PX = 72;
const JUMP_LABEL = "Jump to latest";

// Rows added at the end and rows that grow both keep what the reader is looking at where it is.
const KEEP_POSITION: MaintainVisibleContentPositionConfig = { data: true, size: true };

// A row that grows, such as the working row's clock, has to re-pin the end; the composer's own
// growth must not, or it would drag the rows above it.
const KEEP_AT_END: MaintainScrollAtEndOptions = {
  animated: false,
  on: { dataChange: true, itemLayout: true, layout: true, footerLayout: false },
};

const NOT_AT_END = false;

// The list measures its rows, header and footer but not its container's padding, so space at the
// edges given as padding would sit past what it scrolls to and the last row would stop short.
const EDGE_SPACE = <div className="h-4" />;

type ScrollFrame = NativeSyntheticEvent<NativeScrollEvent>;

function metricsOf(frame: ScrollFrame): ScrollMetrics {
  return {
    offset: frame.nativeEvent.contentOffset.y,
    viewport: frame.nativeEvent.layoutMeasurement.height,
    content: frame.nativeEvent.contentSize.height,
  };
}

function keyOf(row: TimelineRow): string {
  return row.id;
}

function typeOf(row: TimelineRow): TimelineRowKind {
  return row.kind;
}

export interface TimelineProps {
  readonly rows: readonly TimelineRow[];
  readonly disclosures: ReadonlyMap<string, boolean>;
  readonly busy: boolean;
  readonly actions: TimelineActions;
}

export function Timeline({ rows, disclosures, busy, actions }: TimelineProps): ReactElement {
  const list = useRef<LegendListRef>(null);
  const [following, setFollowing] = useState(true);

  const onScroll = useCallback((frame: ScrollFrame): void => {
    if (atEnd(metricsOf(frame))) {
      setFollowing(true);
    }
  }, []);

  // The geometry is read at the moment of the gesture rather than remembered from the last scroll
  // event, because the first gesture of a session comes before any scroll event has been seen.
  const measure = useCallback((): ScrollMetrics | null => {
    const node = list.current?.getScrollableNode();
    if (node === undefined) {
      return null;
    }
    return { offset: node.scrollTop, viewport: node.clientHeight, content: node.scrollHeight };
  }, []);

  // Following stops on a gesture away from the live edge, not on a position: while the timeline is
  // pinned there is no scroll event to arm it again, so a break made by mistake would be final.
  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>): void => {
      const seen = measure();
      if (event.deltaY < 0 && seen !== null && canScroll(seen)) {
        setFollowing(false);
      }
    },
    [measure],
  );

  const jump = useCallback((): void => {
    setFollowing(true);
    void list.current?.scrollToEnd({ animated: true });
  }, []);

  const renderRow = useCallback(
    ({ item }: LegendListRenderItemProps<TimelineRow>): ReactElement => (
      <Row row={item} disclosures={disclosures} busy={busy} actions={actions} />
    ),
    [actions, busy, disclosures],
  );

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", SETTLES_ON_RESIZE)}
      onWheel={onWheel}
    >
      <LegendList
        ref={list}
        data={rows}
        extraData={disclosures}
        alignItemsAtEnd
        keyExtractor={keyOf}
        getItemType={typeOf}
        renderItem={renderRow}
        estimatedItemSize={ESTIMATED_ROW_PX}
        maintainVisibleContentPosition={KEEP_POSITION}
        maintainScrollAtEnd={following ? KEEP_AT_END : NOT_AT_END}
        initialScrollAtEnd
        onScroll={onScroll}
        className="timeline-scroll flex-1"
        ListHeaderComponent={EDGE_SPACE}
        ListFooterComponent={EDGE_SPACE}
        aria-label="Session timeline"
      />
      {following ? null : (
        <PlainButton
          onClick={jump}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-body font-medium text-ink-2 shadow-raised transition-colors duration-100 hover:text-ink"
        >
          {JUMP_LABEL}
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </PlainButton>
      )}
    </div>
  );
}
