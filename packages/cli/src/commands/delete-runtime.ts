import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import type { ResourceView } from "../output/view";
import { promptConfirm } from "../output/prompt";
import { renderSummary } from "../output/render";

import type { CommonContext } from "./context";

export const DeleteResult = z.object({
  deleted: z.boolean(),
  aborted: z.boolean(),
  id: z.number().int(),
});
type DeleteResultJson = z.infer<typeof DeleteResult>;

const deleteResultView: ResourceView<DeleteResultJson> = {
  compactPick: DeleteResult,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "deleted", label: "Deleted" },
    { key: "aborted", label: "Aborted" },
  ],
};

interface ConfirmAndDeleteArgs {
  id: number;
  yes: boolean;
  promptMessage: string;
  successMessage: string;
  abortMessage: string;
  deleteResource: () => Promise<void>;
  ctx: CommonContext;
}

interface ConfirmArgs {
  yes: boolean;
  /** What the refusal names, e.g. `delete 42`. */
  action: string;
  promptMessage: string;
}

// `true` to go ahead. Without `--yes` a terminal is asked; anything else is refused, because a
// script that forgot `--yes` must not destroy what it never saw a prompt for.
export async function confirmDestructive(args: ConfirmArgs): Promise<boolean> {
  if (args.yes) {
    return true;
  }
  if (process.stdin.isTTY !== true) {
    throw new ConfigError(
      `refusing to ${args.action} without confirmation — pass --yes to proceed non-interactively`,
    );
  }
  return promptConfirm({ message: args.promptMessage, initialValue: false });
}

export async function confirmAndDelete(args: ConfirmAndDeleteArgs): Promise<void> {
  const confirmed = await confirmDestructive({
    yes: args.yes,
    action: `delete ${args.id}`,
    promptMessage: args.promptMessage,
  });
  if (!confirmed) {
    renderSummary(
      { deleted: false, aborted: true, id: args.id },
      deleteResultView,
      args.abortMessage,
      args.ctx,
    );
    return;
  }
  await args.deleteResource();
  renderSummary(
    { deleted: true, aborted: false, id: args.id },
    deleteResultView,
    args.successMessage,
    args.ctx,
  );
}
