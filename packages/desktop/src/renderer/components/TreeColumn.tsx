import { createContext, useContext, type ReactElement, type ReactNode } from "react";

import type { ResizeBinding } from "@/layout";

import { ResizeHandle } from "./ui/resize-handle";

const TREE_HANDLE_LABEL = "Resize the file tree";

// The tree's handle, which the shell binds to the layout. Every tab's tree shares it, so the Files
// and Metabase tabs keep one width.
export const TreeResize = createContext<ResizeBinding | null>(null);

interface TreeColumnProps {
  readonly children: ReactNode;
}

// A tab's file tree, flush with the side panel's trailing edge beside what it opens, with its
// handle on the leading edge.
export function TreeColumn({ children }: TreeColumnProps): ReactElement {
  const binding = useContext(TreeResize);
  return (
    <>
      {binding === null ? null : <ResizeHandle label={TREE_HANDLE_LABEL} {...binding} />}
      <div className="panel-tree relative flex shrink-0 flex-col border-l border-line bg-canvas">
        {children}
      </div>
    </>
  );
}
