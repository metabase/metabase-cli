import { Writable } from "node:stream";

export function writeRawStdout(text: string): void {
  process.stdout.write(text);
}

export async function pipeToStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
  await stream.pipeTo(Writable.toWeb(process.stdout));
}
