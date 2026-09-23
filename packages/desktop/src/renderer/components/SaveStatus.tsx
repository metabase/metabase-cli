import { Check } from "lucide-react";
import type { ReactElement } from "react";

import { assertNever } from "../../contracts/assert-never";
import type { RequestState } from "@/request";

import { Spinner } from "./ui/spinner";

export type SaveOutcome = "saved" | "unchanged";

interface SaveStatusProps {
  readonly state: RequestState<SaveOutcome>;
  readonly pendingLabel: string;
}

export function SaveStatus({ state, pendingLabel }: SaveStatusProps): ReactElement | null {
  switch (state.status) {
    case "idle": {
      return null;
    }
    case "running": {
      return <Spinner label={pendingLabel} />;
    }
    case "failed": {
      return null;
    }
    case "ready": {
      return state.value === "saved" ? <Saved /> : null;
    }
    default: {
      return assertNever(state);
    }
  }
}

function Saved(): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 text-body text-ink-2">
      <Check aria-hidden className="size-3.5 text-green" />
      Saved
    </span>
  );
}
