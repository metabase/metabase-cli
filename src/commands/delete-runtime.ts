import { z } from "zod";

import { ConfigError } from "../core/errors";
import type { Client } from "../core/http/client";
import type { ResourceView } from "../domain/view";
import { promptConfirm } from "../output/prompt";
import { renderItem } from "../output/render";

import type { CommonContext } from "./context";

export const DeleteResult = z.object({
  deleted: z.boolean(),
  aborted: z.boolean(),
  id: z.number().int(),
});
export type DeleteResultJson = z.infer<typeof DeleteResult>;

export const deleteResultView: ResourceView<DeleteResultJson> = {
  compactPick: DeleteResult,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "deleted", label: "Deleted" },
    { key: "aborted", label: "Aborted" },
  ],
};

export interface ConfirmAndDeleteArgs {
  id: number;
  path: string;
  yes: boolean;
  promptMessage: string;
  client: Client;
  ctx: CommonContext;
  afterDelete?: () => Promise<void>;
}

export async function confirmAndDelete(args: ConfirmAndDeleteArgs): Promise<void> {
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      throw new ConfigError("--yes required to delete non-interactively");
    }
    const ok = await promptConfirm({
      message: args.promptMessage,
      initialValue: false,
    });
    if (!ok) {
      renderItem({ deleted: false, aborted: true, id: args.id }, deleteResultView, args.ctx);
      return;
    }
  }
  await args.client.requestRaw(args.path, {
    method: "DELETE",
    expectContentType: "binary",
  });
  if (args.afterDelete) {
    await args.afterDelete();
  }
  renderItem({ deleted: true, aborted: false, id: args.id }, deleteResultView, args.ctx);
}
