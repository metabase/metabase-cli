import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import type { UpdateState } from "../../contracts/updates";
import { rde } from "@/bridge";
import { updateToast, type UpdateAction } from "@/updates";

import { Button } from "./ui/button";
import { Toast } from "./ui/toast";

const RUN_ACTION: Readonly<Record<UpdateAction, () => Promise<UpdateState>>> = {
  download: () => rde.updatesDownload(),
  install: () => rde.updatesInstall(),
};

export function UpdateToast(): ReactElement | null {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pushed = useRef(false);

  // A push that lands before the first read has answered is newer than that answer.
  useEffect(() => {
    const unsubscribe = rde.onUpdateState((next) => {
      pushed.current = true;
      setState(next);
    });
    void rde.updatesRead().then((read) => {
      if (!pushed.current) {
        setState(read);
      }
    });
    return unsubscribe;
  }, []);

  if (state === null) {
    return null;
  }
  const view = updateToast(state);
  if (view === null || view.key === dismissed) {
    return null;
  }
  const action = view.action;
  return (
    <Toast
      onDismiss={() => {
        setDismissed(view.key);
      }}
    >
      <span className="min-w-0 flex-1">{view.message}</span>
      {action === null ? null : (
        <Button
          size="sm"
          onClick={() => {
            void RUN_ACTION[action.kind]().then(setState);
          }}
        >
          {action.label}
        </Button>
      )}
    </Toast>
  );
}
