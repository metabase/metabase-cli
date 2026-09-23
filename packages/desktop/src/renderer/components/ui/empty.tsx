import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

const EMPTY_CLASS = "flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-ink-3";

// `children` is the one action that ends the emptiness, when there is one.
interface EmptyProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly children?: ReactNode;
}

export function Empty({ icon: Icon, label, children }: EmptyProps): ReactElement {
  return (
    <div className={EMPTY_CLASS}>
      <Icon aria-hidden className="size-5" />
      <p className="text-body">{label}</p>
      {children}
    </div>
  );
}

interface EmptyProblemProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly summary: string;
  readonly detail: string;
}

// What went wrong in one plain line, what the source said in a quiet one, and all of it on hover.
export function EmptyProblem({
  icon: Icon,
  label,
  summary,
  detail,
}: EmptyProblemProps): ReactElement {
  return (
    <div role="status" className={`${EMPTY_CLASS} px-4 text-center`} title={detail}>
      <Icon aria-hidden className="size-5" />
      <p className="text-body text-ink-2">{label}</p>
      <p className="line-clamp-2 font-mono text-meta break-all">{summary}</p>
    </div>
  );
}

interface EmptyLoadingProps {
  readonly label: string;
}

export function EmptyLoading({ label }: EmptyLoadingProps): ReactElement {
  return (
    <div role="status" className={EMPTY_CLASS}>
      <LoaderCircle aria-hidden className="size-5 animate-spin" />
      <p className="text-body">{label}</p>
    </div>
  );
}
