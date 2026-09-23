import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "./button";

interface ToastProps {
  readonly children: ReactNode;
  readonly onDismiss: () => void;
}

function Toast({ children, onDismiss }: ToastProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="toast"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-card bg-surface py-2.5 pr-2.5 pl-3.5 text-body text-ink shadow-overlay"
    >
      {children}
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
        <X aria-hidden />
      </Button>
    </div>
  );
}

export { Toast };
