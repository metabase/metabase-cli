import type { ReactElement, ReactNode } from "react";

import { cn } from "@/cn";

export type NoteTone = "info" | "warning" | "error";

const NOTE_TONES: Readonly<Record<NoteTone, string>> = {
  info: "bg-inset text-ink-2",
  warning: "bg-orange-tint text-orange",
  error: "bg-red-tint text-red",
};

const ALERT_TONES: Readonly<Record<NoteTone, boolean>> = {
  info: false,
  warning: false,
  error: true,
};

interface NoteProps {
  readonly tone: NoteTone;
  readonly children: ReactNode;
}

export function Note({ tone, children }: NoteProps): ReactElement {
  return (
    <p
      role={ALERT_TONES[tone] ? "alert" : "note"}
      className={cn("rounded-chip px-2.5 py-1.5 text-body", NOTE_TONES[tone])}
    >
      {children}
    </p>
  );
}
