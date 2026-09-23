import type { CSSProperties, ReactElement } from "react";

const SHIMMER_MS = 1400;

const SHIMMER_STYLE: CSSProperties = {
  backgroundImage: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
  backgroundSize: "200% 100%",
  animation: `shimmer-text ${SHIMMER_MS}ms linear infinite`,
};

interface ShimmerTextProps {
  readonly text: string;
  readonly live: boolean;
}

export function ShimmerText({ text, live }: ShimmerTextProps): ReactElement {
  if (!live) {
    return <span className="text-body font-medium whitespace-nowrap text-ink-2">{text}</span>;
  }
  return (
    <span
      role="status"
      className="bg-clip-text text-body font-medium whitespace-nowrap text-transparent"
      style={SHIMMER_STYLE}
    >
      {text}
    </span>
  );
}
