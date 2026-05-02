import type { Manifest } from "../runtime/manifest";

export function writeManifest(manifest: Manifest): void {
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
}
