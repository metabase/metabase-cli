import type { ReactElement, ReactNode } from "react";

import { cn } from "@/cn";

interface DetailRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

export function DetailRow({ label, children }: DetailRowProps): ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-ink-2">{label}</span>
      {children}
    </div>
  );
}

interface DetailProps {
  readonly label: string;
  readonly value: string;
  readonly mono: boolean;
}

export function Detail({ label, value, mono }: DetailProps): ReactElement {
  return (
    <DetailRow label={label}>
      <span className={cn("break-all text-ink", mono && "font-mono")}>{value}</span>
    </DetailRow>
  );
}

interface OptionalDetailProps {
  readonly label: string;
  readonly value: string | null;
  readonly absent: string;
  readonly mono: boolean;
}

export function OptionalDetail({ label, value, absent, mono }: OptionalDetailProps): ReactElement {
  if (value === null) {
    return (
      <DetailRow label={label}>
        <span className="text-ink-3">{absent}</span>
      </DetailRow>
    );
  }
  return <Detail label={label} value={value} mono={mono} />;
}
