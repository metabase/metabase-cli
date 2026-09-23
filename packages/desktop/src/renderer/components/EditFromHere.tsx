import { useState, type ReactElement } from "react";

import type { ActionOutcome } from "../../contracts/changes";
import type { Workspace } from "../../contracts/events";

import { Note } from "./Note";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";

export interface EditPoint {
  readonly turnId: string;
  readonly text: string;
}

interface EditFromHereProps {
  readonly point: EditPoint | null;
  readonly workspace: Workspace;
  readonly onClose: () => void;
  readonly onConfirm: (point: EditPoint, restoreFiles: boolean) => Promise<ActionOutcome>;
}

// Restoring the files is offered only where the checkout is the session's own: in the repository
// itself another tool or session may be writing.
export function EditFromHere({
  point,
  workspace,
  onClose,
  onConfirm,
}: EditFromHereProps): ReactElement {
  const [restoreFiles, setRestoreFiles] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ownCheckout = workspace.kind === "worktree";

  const close = (): void => {
    setRefusal(null);
    setRestoreFiles(false);
    onClose();
  };

  const confirm = async (): Promise<void> => {
    if (point === null) {
      return;
    }
    setBusy(true);
    const outcome = await onConfirm(point, ownCheckout && restoreFiles);
    setBusy(false);
    if (outcome.kind === "done") {
      close();
      return;
    }
    setRefusal(outcome.message);
  };

  return (
    <Dialog
      open={point !== null}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Edit from this prompt?</DialogTitle>
        <DialogDescription>
          Everything after this prompt is dropped, and the prompt comes back to the composer.
        </DialogDescription>
        {ownCheckout ? (
          <Label>
            <Checkbox
              checked={restoreFiles}
              onCheckedChange={(checked) => {
                setRestoreFiles(checked);
              }}
            />
            Restore the files too
          </Label>
        ) : (
          <Note tone="info">
            This session works in the repository, so its files stay as they are.
          </Note>
        )}
        {refusal === null ? null : (
          <p role="alert" className="text-body text-red">
            {refusal}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              void confirm();
            }}
          >
            Edit from here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
