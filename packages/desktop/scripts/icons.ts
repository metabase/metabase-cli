// Regenerates the app's icons from `build/icon.svg`: `bun scripts/icons.ts` from the desktop package.
// Needs bun and Playwright's Chromium (`bunx playwright install chromium`); Chromium draws every
// size from the vector, and the `.ico` and `.icns` containers are written here around its PNGs.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium, type Page } from "playwright";

const BUILD_DIR = resolve(import.meta.dirname, "..", "build");
const SOURCE = join(BUILD_DIR, "icon.svg");
const MASTER = join(BUILD_DIR, "icon.png");
const ICO = join(BUILD_DIR, "icon.ico");
const ICNS = join(BUILD_DIR, "icon.icns");
const LINUX_DIR = join(BUILD_DIR, "icons");

const MASTER_SIZE = 1024;
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024] as const;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

// Each `.icns` slot holds a PNG of one pixel size; the `@2x` slots repeat a size for Retina.
const ICNS_SLOTS = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "ic11", size: 32 },
  { type: "ic12", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic13", size: 256 },
  { type: "ic08", size: 256 },
  { type: "ic14", size: 512 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 },
] as const;

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;
const ICO_TYPE_ICON = 1;
const ICO_PLANES = 1;
const ICO_BITS_PER_PIXEL = 32;
// A dimension byte holds 0–255, and 0 stands for 256.
const ICO_MAX_DIMENSION = 255;

const ICNS_MAGIC = "icns";
const ICNS_HEADER_BYTES = 8;

type Rendered = ReadonlyMap<number, Buffer>;

async function renderPng(page: Page, svg: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<body style="margin:0"><img src="${source}" width="${size}" height="${size}"></body>`,
  );
  return page.screenshot({ omitBackground: true, type: "png" });
}

async function renderAll(svg: string, sizes: ReadonlySet<number>): Promise<Rendered> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const rendered = new Map<number, Buffer>();
    for (const size of sizes) {
      rendered.set(size, await renderPng(page, svg, size));
    }
    return rendered;
  } finally {
    await browser.close();
  }
}

function png(rendered: Rendered, size: number): Buffer {
  const image = rendered.get(size);
  if (image === undefined) {
    throw new Error(`no ${size}px rendering`);
  }
  return image;
}

function icoDimension(size: number): number {
  return size > ICO_MAX_DIMENSION ? 0 : size;
}

function ico(rendered: Rendered): Buffer {
  const images = ICO_SIZES.map((size) => png(rendered, size));
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(ICO_TYPE_ICON, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * images.length;
  const entries = ICO_SIZES.map((size) => {
    const image = png(rendered, size);
    const entry = Buffer.alloc(ICO_ENTRY_BYTES);
    entry.writeUInt8(icoDimension(size), 0);
    entry.writeUInt8(icoDimension(size), 1);
    entry.writeUInt16LE(ICO_PLANES, 4);
    entry.writeUInt16LE(ICO_BITS_PER_PIXEL, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

function icns(rendered: Rendered): Buffer {
  const chunks = ICNS_SLOTS.map(({ type, size }) => {
    const image = png(rendered, size);
    const head = Buffer.alloc(ICNS_HEADER_BYTES);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(ICNS_HEADER_BYTES + image.length, 4);
    return Buffer.concat([head, image]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(ICNS_HEADER_BYTES);
  head.write(ICNS_MAGIC, 0, "ascii");
  head.writeUInt32BE(ICNS_HEADER_BYTES + body.length, 4);
  return Buffer.concat([head, body]);
}

async function main(): Promise<void> {
  const svg = await readFile(SOURCE, "utf8");
  const sizes = new Set<number>([
    MASTER_SIZE,
    ...LINUX_SIZES,
    ...ICO_SIZES,
    ...ICNS_SLOTS.map((slot) => slot.size),
  ]);
  const rendered = await renderAll(svg, sizes);

  await mkdir(LINUX_DIR, { recursive: true });
  await writeFile(MASTER, png(rendered, MASTER_SIZE));
  for (const size of LINUX_SIZES) {
    await writeFile(join(LINUX_DIR, `${size}x${size}.png`), png(rendered, size));
  }
  await writeFile(ICO, ico(rendered));
  await writeFile(ICNS, icns(rendered));
}

await main();
