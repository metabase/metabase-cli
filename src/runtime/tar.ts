const BLOCK_SIZE = 512;
const REGULAR_FILE_MODE = 0o644;
const DIR_MODE = 0o755;
const NAME_FIELD_LENGTH = 100;
const TYPE_FLAG_REGULAR = "0";
const TYPE_FLAG_DIRECTORY = "5";

export interface TarFileEntry {
  type: "file";
  name: string;
  content: string | Uint8Array;
  mode?: number;
  mtime?: number;
}

export interface TarDirectoryEntry {
  type: "directory";
  name: string;
  mode?: number;
  mtime?: number;
}

export type TarEntry = TarFileEntry | TarDirectoryEntry;

const textEncoder = new TextEncoder();

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? textEncoder.encode(content) : content;
}

// ustar octal: (length - 1) digits, NUL terminator. The chksum field uses a slightly
// different encoding (6 digits + NUL + space) and is written separately.
function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const digits = length - 1;
  const octal = Math.trunc(value).toString(8).padStart(digits, "0");
  if (octal.length > digits) {
    throw new Error(`tar value ${value} exceeds octal field width ${digits}`);
  }
  for (let i = 0; i < digits; i++) {
    target[offset + i] = octal.charCodeAt(i);
  }
  target[offset + length - 1] = 0;
}

function writeString(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = textEncoder.encode(value);
  if (bytes.length > length) {
    throw new Error(`tar string field of length ${length} cannot hold ${bytes.length} bytes`);
  }
  target.set(bytes, offset);
}

function writeHeader(
  out: Uint8Array,
  offset: number,
  name: string,
  size: number,
  mode: number,
  mtime: number,
  typeFlag: string,
): void {
  if (textEncoder.encode(name).length > NAME_FIELD_LENGTH) {
    throw new Error(`tar entry name exceeds ${NAME_FIELD_LENGTH} bytes: ${name}`);
  }
  writeString(out, offset, NAME_FIELD_LENGTH, name);
  writeOctal(out, offset + 100, 8, mode & 0o7777);
  writeOctal(out, offset + 108, 8, 0); // uid
  writeOctal(out, offset + 116, 8, 0); // gid
  writeOctal(out, offset + 124, 12, size);
  writeOctal(out, offset + 136, 12, mtime);
  // Chksum is computed over the whole header with the chksum field treated as 8 spaces.
  for (let i = 148; i < 156; i++) {
    out[offset + i] = 0x20;
  }
  out[offset + 156] = typeFlag.charCodeAt(0);
  // ustar magic + version "00".
  writeString(out, offset + 257, 6, "ustar");
  out[offset + 263] = 0x30;
  out[offset + 264] = 0x30;
  let sum = 0;
  for (const byte of out.subarray(offset, offset + BLOCK_SIZE)) {
    sum += byte;
  }
  const sumOctal = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) {
    out[offset + 148 + i] = sumOctal.charCodeAt(i);
  }
  out[offset + 154] = 0;
  out[offset + 155] = 0x20;
}

function paddedSize(size: number): number {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? 0 : BLOCK_SIZE - remainder;
}

interface ResolvedEntry {
  name: string;
  mode: number;
  mtime: number;
  typeFlag: string;
  content: Uint8Array | null;
}

function resolveEntry(entry: TarEntry, fallbackMtime: number): ResolvedEntry {
  if (entry.type === "directory") {
    const name = entry.name.endsWith("/") ? entry.name : `${entry.name}/`;
    return {
      name,
      mode: entry.mode ?? DIR_MODE,
      mtime: entry.mtime ?? fallbackMtime,
      typeFlag: TYPE_FLAG_DIRECTORY,
      content: null,
    };
  }
  return {
    name: entry.name,
    mode: entry.mode ?? REGULAR_FILE_MODE,
    mtime: entry.mtime ?? fallbackMtime,
    typeFlag: TYPE_FLAG_REGULAR,
    content: toBytes(entry.content),
  };
}

// Builds a POSIX ustar archive in memory. Single allocation, single pass: headers,
// content, and inter-block padding are written directly into the output buffer
// (Uint8Array is zero-initialized at allocation, so padding writes are no-ops).
// The trailer is the final 1024 zero bytes of the buffer for the same reason.
export function buildTar(entries: readonly TarEntry[]): Uint8Array {
  const fallbackMtime = Math.floor(Date.now() / 1000);
  const resolved = entries.map((entry) => resolveEntry(entry, fallbackMtime));

  let total = BLOCK_SIZE * 2; // POSIX-required two-block zero trailer.
  for (const entry of resolved) {
    total += BLOCK_SIZE;
    if (entry.content !== null) {
      total += entry.content.length + paddedSize(entry.content.length);
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const entry of resolved) {
    const size = entry.content?.length ?? 0;
    writeHeader(out, offset, entry.name, size, entry.mode, entry.mtime, entry.typeFlag);
    offset += BLOCK_SIZE;
    if (entry.content !== null) {
      out.set(entry.content, offset);
      offset += entry.content.length + paddedSize(entry.content.length);
    }
  }
  return out;
}
