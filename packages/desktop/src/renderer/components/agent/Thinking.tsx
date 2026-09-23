import { ChevronDown, Sparkles } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { ShimmerText } from "./Shimmer";

const TRACE_LINE_MS = 500;
const TRACE_LINE_TOP_PX = -8;
const TRACE_LINE_TRIM_PX = 2;

const CHEVRON_BASE = "size-3.5 shrink-0 text-ink-3 transition-transform duration-300";

interface ThinkingProps {
  readonly summary: string;
  readonly working: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}

function traceLineStyle(height: number | null): CSSProperties {
  if (height === null) {
    return { top: TRACE_LINE_TOP_PX, height: 0 };
  }
  return {
    top: TRACE_LINE_TOP_PX,
    height: Math.max(height - TRACE_LINE_TRIM_PX, 0),
    transition: `height ${TRACE_LINE_MS}ms var(--ease-out-strong)`,
  };
}

export function Thinking({
  summary,
  working,
  open,
  onToggle,
  children,
}: ThinkingProps): ReactElement {
  const trace = useRef<HTMLDivElement>(null);
  const [traceHeight, setTraceHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = trace.current;
    setTraceHeight(element === null ? null : element.offsetHeight);
  }, [open, children]);

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        <Sparkles
          aria-hidden
          className={`size-4 shrink-0 ${working ? "text-ink-2" : "text-ink-3"}`}
        />
        <ShimmerText text={summary} live={working} />
        <ChevronDown
          aria-hidden
          className={`${CHEVRON_BASE} ${open ? "rotate-180" : "rotate-0"}`}
        />
      </button>

      {open && (
        <div className="relative mt-1 pl-4">
          <span
            aria-hidden
            className="absolute left-2 w-px bg-line"
            style={traceLineStyle(traceHeight)}
          />
          <div ref={trace} className="flex flex-col gap-1 py-1">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
