import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import { useRef, useState } from "react";

import type { ResizeBinding } from "@/layout";
import { widthAfterDrag, widthAfterKey } from "@/layout";

const PRIMARY_BUTTON = 0;

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  readonly width: number;
}

interface ResizeHandleProps extends ResizeBinding {
  readonly label: string;
}

// The edge between two columns. It takes no room of its own: an eight-pixel hit area straddles the
// edge, and the line shows on hover, on focus and while it is dragged. A drag reports each new
// width as the pointer moves and the last one when the pointer lets go.
function ResizeHandle({
  label,
  width,
  range,
  growth,
  onDragStart,
  onPreview,
  onCommit,
  onReset,
}: ResizeHandleProps): ReactElement {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== PRIMARY_BUTTON) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, width };
    setDragging(true);
    onDragStart();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const next = widthAfterDrag(current.startWidth, event.clientX - current.startX, growth, range);
    if (next === current.width) {
      return;
    }
    drag.current = { ...current, width: next };
    onPreview(next);
  };

  // Capture ends on a release and on a cancel alike, so a drag always ends here.
  const onLostPointerCapture = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    setDragging(false);
    onCommit(current.width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = widthAfterKey(event.key, width, growth, range);
    if (next === null) {
      return;
    }
    event.preventDefault();
    onCommit(next);
  };

  return (
    <div data-slot="resize-handle" className="relative w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        tabIndex={0}
        data-dragging={dragging ? "" : undefined}
        className="resize-handle group absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize justify-center outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onKeyDown}
        onDoubleClick={onReset}
      >
        <div className="h-full w-px transition-colors duration-100 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent group-data-dragging:bg-accent" />
      </div>
    </div>
  );
}

export { ResizeHandle };
