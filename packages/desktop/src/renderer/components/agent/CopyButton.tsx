import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";

import { assertNever } from "../../../contracts/assert-never";
import type { CopyState } from "@/clipboard";
import { COPIED_RESET_MS, COPY_IDLE, copyText } from "@/clipboard";

const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied";

const COPY_TONES: Readonly<Record<CopyState["kind"], string>> = {
  idle: "text-ink-3 hover:text-ink",
  copied: "text-green",
  failed: "text-red",
};

export function copyStatusLabel(state: CopyState): string {
  switch (state.kind) {
    case "idle": {
      return COPY_LABEL;
    }
    case "copied": {
      return COPIED_LABEL;
    }
    case "failed": {
      return state.message;
    }
    default: {
      return assertNever(state);
    }
  }
}

interface CopyButtonProps {
  readonly text: string;
  readonly showLabel: boolean;
}

export function CopyButton({ text, showLabel }: CopyButtonProps): ReactElement {
  const [state, setState] = useState<CopyState>(COPY_IDLE);

  useEffect(() => {
    if (state.kind !== "copied") {
      return;
    }
    const timer = setTimeout(() => {
      setState(COPY_IDLE);
    }, COPIED_RESET_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = useCallback((): void => {
    void copyText(text).then(setState);
  }, [text]);

  const label = copyStatusLabel(state);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={copy}
      className={`flex h-6 min-w-0 items-center gap-1 rounded-chip px-1.5 text-body font-medium transition-colors duration-100 hover:bg-hover ${COPY_TONES[state.kind]}`}
    >
      {state.kind === "copied" ? (
        <Check aria-hidden className="size-3 shrink-0" />
      ) : (
        <Copy aria-hidden className="size-3 shrink-0" />
      )}
      {showLabel ? <span className="truncate">{label}</span> : null}
    </button>
  );
}
