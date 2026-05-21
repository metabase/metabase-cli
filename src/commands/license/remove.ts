import { z } from "zod";

import { clearLicense } from "../../core/auth/storage";
import type { ResourceView } from "../../domain/view";
import { promptConfirm } from "../../output/prompt";
import { renderItem } from "../../output/render";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const LicenseRemoveResult = z.object({
  removed: z.boolean(),
  aborted: z.boolean(),
});
export type LicenseRemoveResultJson = z.infer<typeof LicenseRemoveResult>;

const licenseRemoveView: ResourceView<LicenseRemoveResultJson> = {
  compactPick: LicenseRemoveResult,
  tableColumns: [
    { key: "removed", label: "Removed" },
    { key: "aborted", label: "Aborted" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "remove", description: "Remove the stored license token" },
  capabilities: null,
  args: {
    ...outputFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
  },
  outputSchema: LicenseRemoveResult,
  examples: ["mb license remove --yes"],
  async run({ args, ctx }) {
    if (!args.yes && process.stdin.isTTY === true) {
      const ok = await promptConfirm({
        message: "Remove stored license token?",
        initialValue: false,
      });
      if (!ok) {
        renderItem({ removed: false, aborted: true }, licenseRemoveView, ctx);
        return;
      }
    }

    const removed = await clearLicense();
    renderItem({ removed, aborted: false }, licenseRemoveView, ctx);
  },
});
