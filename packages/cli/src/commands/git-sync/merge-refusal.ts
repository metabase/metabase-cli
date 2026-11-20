import { featureAvailability, type FeatureName } from "@metabase/client/version/features";

const MERGE_FEATURE = "remoteSyncMerge" satisfies FeatureName;

type SyncRun = "import" | "export";

export function mergeRefusal(run: SyncRun): string {
  return `\`--merge\` needs \`${MERGE_FEATURE}\` (${featureAvailability(MERGE_FEATURE)}): on a server without it, the CLI refuses \`--merge\` before the request (exit 2), because such a server ignores it and runs a plain ${run}.`;
}
