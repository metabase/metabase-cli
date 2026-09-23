import { errorMessage } from "@metabase/client/errors";
import { parseJsonResult } from "@metabase/client/json";
import { z } from "zod";

import { assertNever } from "../../../contracts/assert-never";
import type { ProviderLog } from "../log";

import { routeFrame, type CodexNotification, type CodexRequest, type JsonRpcId } from "./protocol";

export const FRAME_MARK = { outbound: "> ", inbound: "< ", stderr: "! " } as const;

const LINE_END = "\n";
const CARRIAGE_RETURN = "\r";
const STDOUT_SOURCE = "codex stdout";
const UNROUTABLE_REASON = "no request, notification or response shape matched";
const UNMATCHED_REASON = "no request is waiting for that id";
const CLOSED_MESSAGE = "The Codex app server closed before it answered.";

const ESCAPE = String.fromCodePoint(27);
const ANSI_SGR = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");
const STDERR_RECORD = /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+\S+:\s+(.*)$/u;
const ERROR_LEVEL = "ERROR";

// Codex prints these at every start on a Linux box without user namespaces and whenever its state
// db lags behind its rollout files; neither is the user's to act on.
const BENIGN_ERRORS: readonly string[] = [
  "Codex's Linux sandbox uses bubblewrap",
  "state db missing rollout path for thread",
  "state db record_discrepancy",
];

export class CodexRequestFailed extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "CodexRequestFailed";
    this.code = code;
  }
}

export class CodexProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexProtocolError";
  }
}

class LineReader {
  private buffer = "";

  take(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    for (;;) {
      const end = this.buffer.indexOf(LINE_END);
      if (end < 0) {
        return lines;
      }
      lines.push(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end + 1);
    }
  }

  flush(): string[] {
    const remainder = this.buffer;
    this.buffer = "";
    return remainder.length === 0 ? [] : [remainder];
  }
}

interface PendingRequest {
  readonly settle: (result: unknown) => void;
  readonly fail: (error: Error) => void;
}

export interface CodexHandlers {
  onNotification(notification: CodexNotification): void;
  onRequest(request: CodexRequest): void;
  onProtocolError(error: CodexProtocolError): void;
  onStderr(message: string): void;
}

export interface CodexClientOptions {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly log: ProviderLog;
  readonly handlers: CodexHandlers;
}

export class CodexClient {
  private readonly stdin: NodeJS.WritableStream;
  private readonly log: ProviderLog;
  private readonly handlers: CodexHandlers;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly frames = new LineReader();
  private readonly records = new LineReader();

  private nextId = 1;
  private lineNumber = 0;
  private closed = false;

  constructor(options: CodexClientOptions) {
    this.stdin = options.stdin;
    this.log = options.log;
    this.handlers = options.handlers;
    options.stdout.setEncoding("utf8");
    options.stderr.setEncoding("utf8");
    options.stdout.on("data", (chunk: string) => {
      this.readFrames(this.frames.take(chunk));
    });
    options.stdout.on("end", () => {
      this.readFrames(this.frames.flush());
    });
    options.stderr.on("data", (chunk: string) => {
      this.readRecords(this.records.take(chunk));
    });
    options.stderr.on("end", () => {
      this.readRecords(this.records.flush());
    });
  }

  async request<T>(method: string, params: unknown, schema: z.ZodType<T>): Promise<T> {
    if (this.closed) {
      throw new CodexProtocolError(CLOSED_MESSAGE);
    }
    const id = this.nextId++;
    this.write({ id, method, params });
    const result = await new Promise<unknown>((settle, fail) => {
      this.pending.set(String(id), { settle, fail });
    });
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      throw new CodexProtocolError(
        `Codex answered ${method} with a result this client cannot read`,
      );
    }
    return parsed.data;
  }

  // The `initialized` handshake is the one frame Codex takes without a `params` key.
  notify(method: string): void {
    this.write({ method });
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ id, result });
  }

  refuseRequest(id: JsonRpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [, request] of this.pending) {
      request.fail(new CodexProtocolError(CLOSED_MESSAGE));
    }
    this.pending.clear();
  }

  private write(frame: object): void {
    const line = `${JSON.stringify(frame)}${LINE_END}`;
    this.log.write(`${FRAME_MARK.outbound}${line}`);
    this.stdin.write(line);
  }

  private readFrames(lines: readonly string[]): void {
    for (const line of lines) {
      this.lineNumber += 1;
      const text = line.endsWith(CARRIAGE_RETURN) ? line.slice(0, -1) : line;
      if (text.length === 0) {
        continue;
      }
      this.log.write(`${FRAME_MARK.inbound}${text}${LINE_END}`);
      this.readFrame(text, this.lineNumber);
    }
  }

  private readFrame(text: string, lineNumber: number): void {
    const parsed = parseJsonResult(text, z.unknown());
    if (!parsed.ok) {
      this.refuse(lineNumber, text, errorMessage(parsed.error));
      return;
    }
    const frame = routeFrame(parsed.value);
    if (frame === null) {
      this.refuse(lineNumber, text, UNROUTABLE_REASON);
      return;
    }
    switch (frame.kind) {
      case "notification": {
        this.handlers.onNotification(frame);
        return;
      }
      case "request": {
        this.handlers.onRequest(frame);
        return;
      }
      case "result": {
        const pending = this.claim(frame.id);
        if (pending === null) {
          this.refuse(lineNumber, text, UNMATCHED_REASON);
          return;
        }
        pending.settle(frame.result);
        return;
      }
      case "failure": {
        const pending = this.claim(frame.id);
        if (pending === null) {
          this.refuse(lineNumber, text, UNMATCHED_REASON);
          return;
        }
        pending.fail(new CodexRequestFailed(frame.error.code, frame.error.message));
        return;
      }
      default: {
        return assertNever(frame);
      }
    }
  }

  private claim(id: JsonRpcId): PendingRequest | null {
    const key = String(id);
    const pending = this.pending.get(key);
    if (pending === undefined) {
      return null;
    }
    this.pending.delete(key);
    return pending;
  }

  private refuse(lineNumber: number, text: string, reason: string): void {
    this.handlers.onProtocolError(
      new CodexProtocolError(`${STDOUT_SOURCE} line ${lineNumber} (${reason}): ${text}`),
    );
  }

  private readRecords(lines: readonly string[]): void {
    for (const line of lines) {
      const text = line.endsWith(CARRIAGE_RETURN) ? line.slice(0, -1) : line;
      if (text.length === 0) {
        continue;
      }
      this.log.write(`${FRAME_MARK.stderr}${text}${LINE_END}`);
      this.readRecord(text);
    }
  }

  private readRecord(text: string): void {
    const match = STDERR_RECORD.exec(text.replaceAll(ANSI_SGR, ""));
    if (match === null) {
      return;
    }
    const [, level, message] = match;
    if (level !== ERROR_LEVEL || message === undefined) {
      return;
    }
    if (BENIGN_ERRORS.some((marker) => message.includes(marker))) {
      return;
    }
    this.handlers.onStderr(message);
  }
}
