import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_LIMIT_BYTES = 4 * 1024 * 1024;

const REDACTION = "[redacted]";

const CAPPED_NOTICE = `\n${REDACTION} the provider log reached its size cap and stops here\n`;

const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:Bearer|token)\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\beyJ[A-Za-z0-9._-]{20,}/g,
];

export interface ProviderLog {
  write(chunk: string): void;
  close(): Promise<void>;
}

export function scrub(text: string, secrets: readonly string[]): string {
  let scrubbed = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      scrubbed = scrubbed.split(secret).join(REDACTION);
    }
  }
  for (const pattern of CREDENTIAL_SHAPES) {
    scrubbed = scrubbed.replace(pattern, REDACTION);
  }
  return scrubbed;
}

class FileProviderLog implements ProviderLog {
  private written = 0;
  private capped = false;

  constructor(
    private readonly stream: WriteStream,
    private readonly secrets: readonly string[],
  ) {}

  write(chunk: string): void {
    if (this.capped) {
      return;
    }
    const scrubbed = scrub(chunk, this.secrets);
    const size = Buffer.byteLength(scrubbed, "utf8");
    if (this.written + size > LOG_LIMIT_BYTES) {
      this.capped = true;
      this.stream.write(CAPPED_NOTICE);
      return;
    }
    this.written += size;
    this.stream.write(scrubbed);
  }

  close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.stream.once("error", reject);
      this.stream.end(() => {
        resolve();
      });
    });
  }
}

export interface ProviderLogRequest {
  readonly directory: string;
  readonly sessionId: string;
  readonly secrets: readonly string[];
}

export async function openProviderLog(request: ProviderLogRequest): Promise<ProviderLog> {
  await mkdir(request.directory, { recursive: true });
  const stream = createWriteStream(join(request.directory, `${request.sessionId}.log`), {
    flags: "a",
  });
  return new FileProviderLog(stream, request.secrets);
}
