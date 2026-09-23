import type { GhosttyAnsiPalette, GhosttyColor, GhosttyTheme } from "./ghostty/core";

// Ghostty is told its default colours as bytes and the renderer paints cells with what it hands
// back, so every token is resolved to sRGB through a 1x1 canvas, which understands any CSS notation
// the tokens are written in. The selection stays a CSS string: the renderer overlays it on cells it
// already painted, so it is the one colour that keeps its alpha.
type ColorParser = (css: string) => GhosttyColor | null;

const BLACK: GhosttyColor = { r: 0, g: 0, b: 0 };

const PALETTE_TOKENS = [
  "--term-black",
  "--term-red",
  "--term-green",
  "--term-yellow",
  "--term-blue",
  "--term-magenta",
  "--term-cyan",
  "--term-white",
  "--term-bright-black",
  "--term-bright-red",
  "--term-bright-green",
  "--term-bright-yellow",
  "--term-bright-blue",
  "--term-bright-magenta",
  "--term-bright-cyan",
  "--term-bright-white",
] as const;

export class MissingTokenError extends Error {
  constructor(token: string) {
    super(`tokens.css defines no ${token}`);
    this.name = "MissingTokenError";
  }
}

function canvasColorParser(): ColorParser {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return (css) => {
    if (context === null) {
      return null;
    }
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    if (
      red === undefined ||
      green === undefined ||
      blue === undefined ||
      alpha === undefined ||
      alpha === 0
    ) {
      return null;
    }
    return { r: red, g: green, b: blue };
  };
}

// Read from <html> as the browser resolved it, so the terminal follows the page's theme.
export function documentTerminalTheme(): GhosttyTheme {
  const style = window.getComputedStyle(document.documentElement);
  const parse = canvasColorParser();
  const token = (name: string): string => {
    const value = style.getPropertyValue(name).trim();
    if (value.length === 0) {
      throw new MissingTokenError(name);
    }
    return value;
  };
  const color = (name: string): GhosttyColor => parse(token(name)) ?? BLACK;
  const palette: GhosttyAnsiPalette = [
    color(PALETTE_TOKENS[0]),
    color(PALETTE_TOKENS[1]),
    color(PALETTE_TOKENS[2]),
    color(PALETTE_TOKENS[3]),
    color(PALETTE_TOKENS[4]),
    color(PALETTE_TOKENS[5]),
    color(PALETTE_TOKENS[6]),
    color(PALETTE_TOKENS[7]),
    color(PALETTE_TOKENS[8]),
    color(PALETTE_TOKENS[9]),
    color(PALETTE_TOKENS[10]),
    color(PALETTE_TOKENS[11]),
    color(PALETTE_TOKENS[12]),
    color(PALETTE_TOKENS[13]),
    color(PALETTE_TOKENS[14]),
    color(PALETTE_TOKENS[15]),
  ];
  return {
    foreground: color("--ink"),
    background: color("--surface"),
    cursor: color("--term-cursor"),
    selectionBackground: token("--term-selection"),
    palette,
  };
}
