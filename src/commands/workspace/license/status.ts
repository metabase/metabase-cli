import { z } from "zod";

import { readLicense } from "../../../core/auth/storage";
import type { ResourceView } from "../../../domain/view";
import { renderItem } from "../../../output/render";
import { outputFlags } from "../../flags";
import { defineMetabaseCommand } from "../../runtime";

export const LicenseStatus = z.object({
  present: z.boolean(),
});
export type LicenseStatusJson = z.infer<typeof LicenseStatus>;

const licenseStatusView: ResourceView<LicenseStatusJson> = {
  compactPick: LicenseStatus,
  tableColumns: [{ key: "present", label: "Present" }],
};

export default defineMetabaseCommand({
  meta: {
    name: "status",
    description: "Show whether a license token is stored (does not reveal value)",
  },
  capabilities: null,
  args: { ...outputFlags },
  outputSchema: LicenseStatus,
  examples: ["mb workspace license status", "mb workspace license status --json"],
  async run({ ctx }) {
    const present = (await readLicense()) !== null;
    renderItem({ present }, licenseStatusView, ctx);
  },
});
