import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ReactElement } from "react";

// `value` is a percentage, or null while the work has not said how far along it is.
interface ProgressProps {
  readonly value: number | null;
  readonly label: string;
}

function Progress({ value, label }: ProgressProps): ReactElement {
  return (
    <ProgressPrimitive.Root value={value} aria-label={label} className="w-full">
      <ProgressPrimitive.Track className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
        <ProgressPrimitive.Indicator className="h-full rounded-full bg-accent" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
