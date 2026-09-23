import { assertNever } from "../contracts/assert-never";
import type { FilePreview } from "../contracts/files";

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

export function sizeLabel(bytes: number): string {
  if (bytes < BYTES_PER_KB) {
    return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  }
  if (bytes < BYTES_PER_MB) {
    return `${Math.round(bytes / BYTES_PER_KB)} KB`;
  }
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

// What the preview says in place of a file it does not show; a text file shows itself.
export function previewNote(preview: FilePreview): string | null {
  switch (preview.kind) {
    case "text": {
      return null;
    }
    case "binary": {
      return `${preview.path} is a binary file of ${sizeLabel(preview.bytes)}. Open it in your editor to see it.`;
    }
    case "too-large": {
      return `${preview.path} is ${sizeLabel(preview.bytes)}, more than the ${sizeLabel(preview.limit)} a preview reads. Open it in your editor to see it.`;
    }
    case "gone": {
      return `${preview.path} is no longer in the checkout.`;
    }
    default: {
      return assertNever(preview);
    }
  }
}
