import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PanelId, PanelLayout } from "../contracts/layout";
import { PANEL_BOUNDS } from "../contracts/layout";
import type { ResizeBinding, SidePanelState } from "@/layout";
import { GROWTH, fitLayout, widthRange } from "@/layout";

// A container that measures its own content, which a drag holds at the width it had when the drag
// began, so it measures once when the drag ends instead of on every pixel.
export const SETTLES_ON_RESIZE = "settles-on-resize";

const WIDTH_PROPERTY: Readonly<Record<PanelId, string>> = {
  sidebar: "--panel-sidebar",
  sidePanel: "--panel-side",
  tree: "--panel-tree",
};
const SETTLED_WIDTH_PROPERTY = "--settled-width";
const RESIZING_ATTRIBUTE = "data-resizing";

function applyWidth(root: HTMLElement, panel: PanelId, width: number): void {
  root.style.setProperty(WIDTH_PROPERTY[panel], `${String(width)}px`);
}

function holdMeasuredContent(root: HTMLElement): void {
  for (const element of root.querySelectorAll<HTMLElement>(`.${SETTLES_ON_RESIZE}`)) {
    const width = element.getBoundingClientRect().width;
    element.style.setProperty(SETTLED_WIDTH_PROPERTY, `${String(width)}px`);
  }
  root.setAttribute(RESIZING_ATTRIBUTE, "");
}

function releaseMeasuredContent(root: HTMLElement): void {
  root.removeAttribute(RESIZING_ATTRIBUTE);
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = (): void => {
      setWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return width;
}

export interface PanelControls {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly handle: (panel: PanelId) => ResizeBinding;
}

interface PanelsInput {
  readonly layout: PanelLayout;
  readonly sidePanel: SidePanelState;
  readonly onLayout: (layout: PanelLayout) => void;
}

// The side columns take their widths from CSS variables on the shell's root. A render sets them to
// the layout fitted to the window; a drag moves them directly, so the tree under the shell does not
// render while the pointer moves, and the layout changes once, when it lets go.
export function usePanels({ layout, sidePanel, onLayout }: PanelsInput): PanelControls {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useViewportWidth();
  const fitted = fitLayout(layout, viewport, sidePanel);

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) {
      return;
    }
    applyWidth(element, "sidebar", fitted.sidebar);
    applyWidth(element, "sidePanel", fitted.sidePanel);
    applyWidth(element, "tree", fitted.tree);
  }, [fitted.sidebar, fitted.sidePanel, fitted.tree]);

  const onRoot = (apply: (element: HTMLElement) => void): void => {
    const element = root.current;
    if (element !== null) {
      apply(element);
    }
  };

  const handle = (panel: PanelId): ResizeBinding => ({
    width: fitted[panel],
    range: widthRange(panel, fitted, viewport, sidePanel),
    growth: GROWTH[panel],
    onDragStart: () => {
      onRoot(holdMeasuredContent);
    },
    onPreview: (width) => {
      onRoot((element) => {
        applyWidth(element, panel, width);
      });
    },
    onCommit: (width) => {
      onRoot(releaseMeasuredContent);
      if (width !== fitted[panel]) {
        onLayout({ ...layout, [panel]: width });
      }
    },
    onReset: () => {
      onLayout({ ...layout, [panel]: PANEL_BOUNDS[panel].initial });
    },
  });

  return { root, handle };
}
