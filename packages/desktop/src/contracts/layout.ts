import { z } from "zod";

// The widths a person chose for the two side columns and for the file tree inside the side panel,
// in CSS pixels. The main area takes the rest of the window, and the open file the rest of the side
// panel. A stored width outside today's bounds is still a valid record; the renderer fits it on
// display.
export const PanelLayout = z
  .object({
    sidebar: z.number().int().positive(),
    sidePanel: z.number().int().positive(),
    tree: z.number().int().positive(),
  })
  .strict();
export type PanelLayout = z.infer<typeof PanelLayout>;

export type PanelId = keyof PanelLayout;

export interface PanelBounds {
  readonly min: number;
  readonly initial: number;
  readonly max: number;
}

export const PANEL_BOUNDS: Readonly<Record<PanelId, PanelBounds>> = {
  sidebar: { min: 208, initial: 280, max: 416 },
  sidePanel: { min: 360, initial: 560, max: 960 },
  tree: { min: 160, initial: 224, max: 480 },
};

export const MAIN_AREA_MIN_WIDTH = 400;

// What the side panel keeps for the open file beside the tree, so the narrowest side panel still
// shows both.
export const OPEN_FILE_MIN_WIDTH = PANEL_BOUNDS.sidePanel.min - PANEL_BOUNDS.tree.min;

// The narrowest window that still shows both side columns at their minimum beside the main area.
export const LAYOUT_MIN_WIDTH =
  PANEL_BOUNDS.sidebar.min + MAIN_AREA_MIN_WIDTH + PANEL_BOUNDS.sidePanel.min;

export const INITIAL_LAYOUT: PanelLayout = {
  sidebar: PANEL_BOUNDS.sidebar.initial,
  sidePanel: PANEL_BOUNDS.sidePanel.initial,
  tree: PANEL_BOUNDS.tree.initial,
};
