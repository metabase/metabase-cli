import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";

interface SpinnerProps {
  readonly label: string;
}

export function Spinner({ label }: SpinnerProps): ReactElement {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-body text-ink-2">
      <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
      {label}
    </span>
  );
}
