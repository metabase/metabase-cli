import { useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

const MENU_ROW_SELECTOR = "[data-menu-row]";
const GLIDE_MS = 220;
const FADE_MS = 150;

const HIGHLIGHT_TRANSITION = [
  `top ${GLIDE_MS}ms var(--ease-out-strong)`,
  `height ${GLIDE_MS}ms var(--ease-out-strong)`,
  `opacity ${FADE_MS}ms ease`,
].join(", ");

const HIGHLIGHT_HIDDEN: CSSProperties = { opacity: 0 };

interface HighlightBox {
  readonly top: number;
  readonly height: number;
  readonly visible: boolean;
}

interface GlideMenuProps {
  readonly children: ReactNode;
}

export function GlideMenu({ children }: GlideMenuProps): ReactElement {
  const wrapper = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HighlightBox | null>(null);

  const moveTo = (target: EventTarget | null): void => {
    const container = wrapper.current;
    if (container === null || !(target instanceof Element)) {
      return;
    }
    const row = target.closest(MENU_ROW_SELECTOR);
    if (!(row instanceof HTMLElement) || !container.contains(row)) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setBox({
      top: rowRect.top - containerRect.top,
      height: rowRect.height,
      visible: true,
    });
  };

  const fadeOut = (): void => {
    setBox((current) => (current === null ? null : { ...current, visible: false }));
  };

  const fadeOutOnExit = (related: EventTarget | null): void => {
    const container = wrapper.current;
    if (container !== null && related instanceof Node && container.contains(related)) {
      return;
    }
    fadeOut();
  };

  const highlightStyle: CSSProperties =
    box === null
      ? HIGHLIGHT_HIDDEN
      : {
          top: box.top,
          height: box.height,
          opacity: box.visible ? 1 : 0,
          transition: HIGHLIGHT_TRANSITION,
        };

  return (
    <div
      ref={wrapper}
      className="relative"
      onMouseOver={(event) => moveTo(event.target)}
      onMouseLeave={fadeOut}
      onFocusCapture={(event) => moveTo(event.target)}
      onBlurCapture={(event) => fadeOutOnExit(event.relatedTarget)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 rounded-control bg-hover"
        style={highlightStyle}
      />
      {children}
    </div>
  );
}
