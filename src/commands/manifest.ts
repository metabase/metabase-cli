import { defineCommand } from "citty";
import type { CommandDef } from "citty";

import { writeJson } from "../output/render";
import { buildManifest } from "../runtime/manifest";

export function createManifestCommand(root: CommandDef): CommandDef {
  return defineCommand({
    meta: {
      name: "__manifest",
      description: "Emit machine-readable command manifest as JSON (for agents)",
      hidden: true,
    },
    args: {},
    async run() {
      const manifest = await buildManifest(root);
      writeJson(manifest);
    },
  });
}
