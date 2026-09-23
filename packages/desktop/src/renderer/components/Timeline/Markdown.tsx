import { memo, useMemo, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import type { MessageState } from "../../markdown/blocks";
import { splitBlocks } from "../../markdown/blocks";
import { CodeBlock } from "../agent/CodeBlock";

import "./markdown.css";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

const TAIL_KEY = "tail";
const TRAILING_NEWLINE = /\n$/;

interface CodeProps {
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}

function isFenced(className: string | undefined, text: string): boolean {
  return (className !== undefined && className.startsWith("language-")) || text.includes("\n");
}

// Nothing can open a URL yet, so a link that looked clickable would do nothing.
const MARKDOWN_COMPONENTS: Components = {
  pre({ children }) {
    return children;
  },
  code({ className, children }: CodeProps) {
    const text = String(children);
    if (!isFenced(className, text)) {
      return <code>{children}</code>;
    }
    return <CodeBlock filename={null} text={text.replace(TRAILING_NEWLINE, "")} />;
  },
  a({ children }) {
    return <span className="text-accent-ink">{children}</span>;
  },
};

interface BlockProps {
  readonly source: string;
}

const Block = memo(function Block({ source }: BlockProps): ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {source}
    </ReactMarkdown>
  );
});

interface MarkdownProps {
  readonly text: string;
  readonly state: MessageState;
}

export function Markdown({ text, state }: MarkdownProps): ReactElement {
  const blocks = useMemo(() => splitBlocks(text, state), [text, state]);
  return (
    <div className="markdown min-w-0 text-body text-ink">
      {blocks.stable.map((source, index) => (
        <Block key={index} source={source} />
      ))}
      {blocks.tail.length === 0 ? null : <Block key={TAIL_KEY} source={blocks.tail} />}
    </div>
  );
}
