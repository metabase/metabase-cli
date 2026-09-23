import type { PanelId, PanelLayout } from "../contracts/layout";
import { MAIN_AREA_MIN_WIDTH, OPEN_FILE_MIN_WIDTH, PANEL_BOUNDS } from "../contracts/layout";

// Which way a handle's column grows as the handle moves right: the sidebar's handle is its
// trailing edge, the side panel's and the tree's their leading one.
export type Growth = 1 | -1;

export const GROWTH: Readonly<Record<PanelId, Growth>> = { sidebar: 1, sidePanel: -1, tree: -1 };

export interface WidthRange {
  readonly min: number;
  readonly max: number;
}

// What a column's handle needs: where it stands, how far it may go, and what to tell the shell as a
// drag begins, moves and ends, a key moves it, or a double-click asks for the initial width.
export interface ResizeBinding {
  readonly width: number;
  readonly range: WidthRange;
  readonly growth: Growth;
  readonly onDragStart: () => void;
  readonly onPreview: (width: number) => void;
  readonly onCommit: (width: number) => void;
  readonly onReset: () => void;
}

const KEY_STEP_PX = 16;

// Where the side panel stands: out of the way, a column beside the chat, or in the chat's place.
export type SidePanelState = "closed" | "open" | "expanded";

// The two columns of the window, which the tree inside the side panel fits against.
type WindowColumns = Pick<PanelLayout, "sidebar" | "sidePanel">;

type RoomOf = (fitted: WindowColumns, viewport: number, state: SidePanelState) => number;

// What takes the rest of the window beside the sidebar, and must keep its minimum: the chat, or the
// expanded side panel in its place.
const REST_MIN_WIDTH: Readonly<Record<SidePanelState, number>> = {
  closed: MAIN_AREA_MIN_WIDTH,
  open: MAIN_AREA_MIN_WIDTH,
  expanded: PANEL_BOUNDS.sidePanel.min,
};

// Only an open side panel is a column of its own width; a closed one takes none and moves its
// toggle into the main area's strip, and an expanded one takes the rest.
const NO_COLUMN_WIDTH = 0;

const KEY_MOVES: ReadonlyMap<string, Growth> = new Map([
  ["ArrowRight", 1],
  ["ArrowLeft", -1],
]);

function clamp(value: number, range: WidthRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}

function sidePanelColumn(state: SidePanelState, width: number): number {
  return state === "open" ? width : NO_COLUMN_WIDTH;
}

// How wide the side panel shows: the rest of the window when expanded, its own column otherwise,
// which is also the width a closed one opens at.
function sidePanelWidth(state: SidePanelState, fitted: WindowColumns, viewport: number): number {
  return state === "expanded" ? viewport - fitted.sidebar : fitted.sidePanel;
}

// How much a column may take while the others stay put: the sidebar and the side panel leave what
// takes the rest its minimum, and the tree leaves the open file beside it its own.
const ROOM: Readonly<Record<PanelId, RoomOf>> = {
  sidebar: (fitted, viewport, state) =>
    viewport - REST_MIN_WIDTH[state] - sidePanelColumn(state, fitted.sidePanel),
  sidePanel: (fitted, viewport, state) => viewport - REST_MIN_WIDTH[state] - fitted.sidebar,
  tree: (fitted, viewport, state) => sidePanelWidth(state, fitted, viewport) - OPEN_FILE_MIN_WIDTH,
};

function fitColumns(
  preferred: PanelLayout,
  viewport: number,
  state: SidePanelState,
): WindowColumns {
  const sidebar = clamp(preferred.sidebar, PANEL_BOUNDS.sidebar);
  const sidePanel = clamp(preferred.sidePanel, PANEL_BOUNDS.sidePanel);
  const overflow = sidebar + sidePanelColumn(state, sidePanel) + REST_MIN_WIDTH[state] - viewport;
  if (overflow <= 0) {
    return { sidebar, sidePanel };
  }
  const sidePanelSlack = state === "open" ? sidePanel - PANEL_BOUNDS.sidePanel.min : 0;
  const sidePanelGives = Math.min(overflow, sidePanelSlack);
  const sidebarGives = Math.min(overflow - sidePanelGives, sidebar - PANEL_BOUNDS.sidebar.min);
  return { sidebar: sidebar - sidebarGives, sidePanel: sidePanel - sidePanelGives };
}

// How far a column can move while the others stay put.
export function widthRange(
  panel: PanelId,
  fitted: WindowColumns,
  viewport: number,
  state: SidePanelState,
): WidthRange {
  const bounds = PANEL_BOUNDS[panel];
  const room = ROOM[panel](fitted, viewport, state);
  return { min: bounds.min, max: Math.max(bounds.min, Math.min(bounds.max, room)) };
}

// The widths a layout shows in a viewport: each column within its bounds, and when they do not fit,
// the side panel gives way to its minimum first and the sidebar after it, and the tree to whatever
// the side panel it sits in leaves. What a person chose stays stored, so a wider window shows it
// again.
export function fitLayout(
  preferred: PanelLayout,
  viewport: number,
  state: SidePanelState,
): PanelLayout {
  const columns = fitColumns(preferred, viewport, state);
  const tree = clamp(preferred.tree, widthRange("tree", columns, viewport, state));
  return { ...columns, tree };
}

export function widthAfterDrag(
  start: number,
  pointerTravel: number,
  growth: Growth,
  range: WidthRange,
): number {
  return clamp(Math.round(start + growth * pointerTravel), range);
}

// Arrow keys move the handle the way they point; Home and End take the column to its narrowest and
// widest, as a separator's value does. Any other key is not the handle's.
export function widthAfterKey(
  key: string,
  width: number,
  growth: Growth,
  range: WidthRange,
): number | null {
  if (key === "Home") {
    return range.min;
  }
  if (key === "End") {
    return range.max;
  }
  const move = KEY_MOVES.get(key);
  if (move === undefined) {
    return null;
  }
  return clamp(width + growth * move * KEY_STEP_PX, range);
}
