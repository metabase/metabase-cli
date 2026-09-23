import { FileCode } from "lucide-react";
import type { ReactElement } from "react";

import { CopyButton } from "./CopyButton";

interface CodeBlockProps {
  readonly filename: string | null;
  readonly text: string;
}

export function CodeBlock({ filename, text }: CodeBlockProps): ReactElement {
  const lines = text.split("\n");
  return (
    <div className="relative w-full overflow-hidden rounded-card bg-surface shadow-card">
      {filename === null ? (
        <span className="absolute top-2 right-2 z-10">
          <CopyButton text={text} showLabel={false} />
        </span>
      ) : (
        <div className="flex h-11 items-center gap-2 border-b border-line px-4 text-detail">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FileCode aria-hidden className="size-4 shrink-0 text-ink-3" />
            <span className="truncate font-mono leading-none text-ink">{filename}</span>
          </span>
          <span className="ml-auto">
            <CopyButton text={text} showLabel />
          </span>
        </div>
      )}

      <pre className="relative py-3 font-mono text-detail leading-relaxed text-ink-2">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
        {lines.map((line, index) => (
          <div key={index} className="flex items-start">
            <span className="w-5 shrink-0 text-center text-ink-3 select-none">{index + 1}</span>
            <span className="min-w-0 flex-1 pr-3 pl-2 break-words whitespace-pre-wrap">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
