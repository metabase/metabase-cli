import { Writable } from "node:stream";

export async function pipeToStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
  await stream.pipeTo(Writable.toWeb(process.stdout));
}
