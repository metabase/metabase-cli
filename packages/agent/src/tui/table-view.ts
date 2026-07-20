import type { Theme } from "@earendil-works/pi-coding-agent";
import { hyperlink, visibleWidth } from "@earendil-works/pi-tui";
import { GLYPH } from "./glyphs";

const CELL_MAX = 40;
const CELL_MIN = 3;
const SEPARATOR = ` ${GLYPH.columnRule} `;
const LABEL_SEPARATOR = ": ";

/**
 * A table whose cells may be addresses. `hrefs` is parallel to `rows`: where a cell names an entity
 * — a row's id, its name, the collection it sits in — the reader can open it in the instance
 * instead of copying the id out of the terminal by hand.
 */
export interface DisplayTable {
  columns: string[];
  rows: string[][];
  hrefs?: (string | null)[][] | undefined;
}

/**
 * A laid-out cell. `linked` is what the theme reads: an address the reader can open is worth
 * nothing if it looks like every other cell, and OSC 8 itself paints nothing.
 */
export interface DisplayCell {
  text: string;
  linked: boolean;
}

/** A table that fits the terminal: aligned columns, every cell padded to its column's width. */
export interface ColumnLayout {
  kind: "columns";
  header: string[];
  rows: DisplayCell[][];
  widths: number[];
}

/**
 * A table too wide to align becomes one labelled block per row, the way psql's expanded display
 * does — squeezing twenty columns into eighty cells produces neither a readable row nor a readable
 * column.
 */
export interface BlockLayout {
  kind: "blocks";
  rows: LabelledCell[][];
}

export interface LabelledCell {
  label: string;
  value: DisplayCell;
}

export type TableLayout = ColumnLayout | BlockLayout;

/**
 * Cells are plain text and the theme colors them whole, so the truncation has to stay plain too:
 * pi's `truncateToWidth` closes styles around its ellipsis, and that reset would end the cell's
 * color in the middle of the cell.
 */
function truncateCell(value: string, width: number): string {
  if (visibleWidth(value) <= width) {
    return value;
  }
  const budget = Math.max(0, width - visibleWidth(GLYPH.ellipsis));
  let kept = "";
  for (const char of value) {
    if (visibleWidth(kept + char) > budget) {
      break;
    }
    kept += char;
  }
  return `${kept}${GLYPH.ellipsis}`;
}

function padCell(value: string, width: number): string {
  const cell = truncateCell(value, width);
  return cell + " ".repeat(Math.max(0, width - visibleWidth(cell)));
}

function linkCell(value: string, width: number, href: string | null): DisplayCell {
  const cell = truncateCell(value, width);
  if (href === null) {
    return { text: cell, linked: false };
  }
  return { text: hyperlink(cell, href), linked: true };
}

/** OSC 8 costs no columns: `visibleWidth` skips the escape, so an address pads like plain text. */
function padLinkCell(value: string, width: number, href: string | null): DisplayCell {
  const cell = linkCell(value, width, href);
  const padding = " ".repeat(Math.max(0, width - visibleWidth(cell.text)));
  return { ...cell, text: cell.text + padding };
}

function hrefAt(table: DisplayTable, row: number, column: number): string | null {
  return table.hrefs?.[row]?.[column] ?? null;
}

function naturalWidths(table: DisplayTable): number[] {
  const widths = table.columns.map((column) =>
    Math.max(CELL_MIN, Math.min(CELL_MAX, visibleWidth(column))),
  );
  for (const row of table.rows) {
    for (const [index, cell] of row.entries()) {
      const current = widths[index] ?? CELL_MIN;
      widths[index] = Math.min(CELL_MAX, Math.max(current, visibleWidth(cell)));
    }
  }
  return widths;
}

/** Steals width from the widest column until the row fits, so one long cell cannot crowd out the rest. */
function shrinkToFit(widths: number[], available: number): number[] {
  const overhead = Math.max(0, widths.length - 1) * SEPARATOR.length;
  const total = (): number => widths.reduce((sum, width) => sum + width, 0) + overhead;
  while (total() > available) {
    const widest = widths.reduce(
      (best, width, index) => (width > (widths[best] ?? 0) ? index : best),
      0,
    );
    const width = widths[widest] ?? CELL_MIN;
    if (width <= CELL_MIN) {
      return widths;
    }
    widths[widest] = width - 1;
  }
  return widths;
}

function fitsHorizontally(table: DisplayTable, available: number): boolean {
  const overhead = Math.max(0, table.columns.length - 1) * SEPARATOR.length;
  return table.columns.length * CELL_MIN + overhead <= available;
}

function blockLayout(table: DisplayTable, available: number): BlockLayout {
  const labelWidth = table.columns.reduce(
    (widest, column) => Math.max(widest, visibleWidth(column)),
    CELL_MIN,
  );
  const valueWidth = Math.max(CELL_MIN, available - labelWidth - LABEL_SEPARATOR.length);
  const rows = table.rows.map((row, index) =>
    table.columns.map((name, column) => ({
      label: padCell(name, labelWidth),
      value: linkCell(row[column] ?? "", valueWidth, hrefAt(table, index, column)),
    })),
  );
  return { kind: "blocks", rows };
}

/**
 * The human-facing table, laid out for the terminal it is actually being drawn in, and lossy. The
 * truncation is safe precisely because the model reads `formatModelTable` instead of this.
 */
export function layoutTable(table: DisplayTable, width: number): TableLayout {
  const available = Math.max(CELL_MIN, width);
  if (!fitsHorizontally(table, available)) {
    return blockLayout(table, available);
  }
  const widths = shrinkToFit(naturalWidths(table), available);
  return {
    kind: "columns",
    header: table.columns.map((column, index) => padCell(column, widths[index] ?? CELL_MIN)),
    rows: table.rows.map((row, index) =>
      row.map((cell, column) =>
        padLinkCell(cell, widths[column] ?? CELL_MIN, hrefAt(table, index, column)),
      ),
    ),
    widths,
  };
}

/** An openable cell is worth pointing at, so it is painted as the address it is. */
function paint(cell: DisplayCell, theme: Theme): string {
  return theme.fg(cell.linked ? "mdLink" : "toolOutput", cell.text);
}

function columnLines(layout: ColumnLayout, theme: Theme): string[] {
  const separator = theme.fg("dim", SEPARATOR);
  const rule = theme.fg(
    "dim",
    layout.widths
      .map((width) => GLYPH.rowRule.repeat(width))
      .join(`${GLYPH.rowRule}${GLYPH.crossRule}${GLYPH.rowRule}`),
  );
  const lines = [layout.header.map((cell) => theme.fg("muted", cell)).join(separator), rule];
  for (const row of layout.rows) {
    lines.push(row.map((cell) => paint(cell, theme)).join(separator));
  }
  return lines;
}

function blockLines(layout: BlockLayout, theme: Theme): string[] {
  const lines: string[] = [];
  for (const [index, row] of layout.rows.entries()) {
    if (index > 0) {
      lines.push("");
    }
    for (const cell of row) {
      const label = theme.fg("muted", cell.label);
      lines.push(`${label}${theme.fg("dim", LABEL_SEPARATOR)}${paint(cell.value, theme)}`);
    }
  }
  return lines;
}

export function tableLines(table: DisplayTable, width: number, theme: Theme): string[] {
  const layout = layoutTable(table, width);
  return layout.kind === "columns" ? columnLines(layout, theme) : blockLines(layout, theme);
}

/** One entity, read down the page as its fields — the shape a single written record wants. */
export function recordLines(table: DisplayTable, width: number, theme: Theme): string[] {
  return blockLines(blockLayout(table, Math.max(CELL_MIN, width)), theme);
}
