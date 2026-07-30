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

export async function confirmAndDelete(args: ConfirmAndDeleteArgs): Promise<void> {
  if (!args.yes) {
    if (process.stdin.isTTY !== true) {
      throw new ConfigError(
        `refusing to delete ${args.id} without confirmation — pass --yes to proceed non-interactively`,
      );
    }
    const ok = await promptConfirm({
      message: args.promptMessage,
      initialValue: false,
    });
    if (!ok) {
      renderSummary(
        { deleted: false, aborted: true, id: args.id },
        deleteResultView,
        args.abortMessage,
        args.ctx,
      );
      return;
    }
  }
  await args.deleteResource();
  renderSummary(
    { deleted: true, aborted: false, id: args.id },
    deleteResultView,
    args.successMessage,
    args.ctx,
  );
}
